// Real-time layer: staff devices and customer displays stay in sync via Socket.IO.
import { Server } from 'socket.io';
import { sessionFromCookieHeader, rateLimit } from './auth.js';
import { getStoreSettings, getQrisInfo, listBanks, getTx, getProductLite, isValidDisplayKey } from './data.js';

let io = null;

// What the customer display currently shows: idle | cart | payment | success | cancelled.
let display = { phase: 'idle', txId: null };
let displayTimer = null;

const RESULT_DURATION = { paid: 9000, cancelled: 5000 };

/**
 * The order currently being rung up, mirrored to the customer display.
 * Only one cart is shown at a time: the most recent change from any cashier device wins.
 * Items hold product ids + quantities only; names and prices are always read from the database.
 */
let liveCart = null; // { deviceId, items: [{ productId, qty }], cashier, rev, lastChangedId }
let cartRev = 0;

// Devices that just checked out: ignore a late "non-empty cart" message from them for a few seconds,
// so a delayed update can't replace the QR code that was just shown.
const checkedOut = new Map(); // deviceId -> timestamp
const CHECKOUT_GUARD_MS = 10_000;

const cleanId = (value) => String(value ?? '').replace(/[^\w-]/g, '').slice(0, 64) || null;

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.host || host === req.headers['x-forwarded-host'];
  } catch {
    return false;
  }
}

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    serveClient: false,
    allowRequest: (req, callback) => callback(null, originAllowed(req)),
  });

  io.use((socket, next) => {
    const ip = socket.handshake.address;
    const displayKey = socket.handshake.auth?.displayKey;

    if (displayKey) {
      if (!rateLimit(`display:${ip}`, 30, 10 * 60 * 1000)) return next(new Error('RATE_LIMITED'));
      if (!isValidDisplayKey(displayKey)) return next(new Error('INVALID_DISPLAY_KEY'));
      socket.data.kind = 'display';
      return next();
    }

    const session = sessionFromCookieHeader(socket.handshake.headers.cookie);
    if (!session) return next(new Error('UNAUTHORIZED'));
    socket.data.kind = 'staff';
    socket.data.user = session.user;
    socket.data.tokenHash = session.tokenHash;
    socket.data.deviceId = cleanId(socket.handshake.auth?.deviceId);
    next();
  });

  io.on('connection', (socket) => {
    if (socket.data.kind === 'display') {
      socket.join('display');
      socket.emit('display:state', buildDisplayState());
      broadcastDisplayPresence();
      socket.on('disconnect', broadcastDisplayPresence);
      return; // displays are read-only: no event handlers
    }

    socket.join('staff');
    socket.join(`user:${socket.data.user.id}`);
    socket.join(`session:${socket.data.tokenHash}`);
    socket.emit('display:presence', { count: displayCount() });

    socket.on('cart:update', (payload) => handleCartUpdate(socket, payload));
    socket.on('disconnect', (reason) => {
      // Logged out / app closed on purpose: take that device's cart off the customer display.
      // Network drops and page reloads keep it, since the cart is still on the device.
      if (reason === 'server namespace disconnect' || reason === 'client namespace disconnect') {
        dropCartOf(socket.data.deviceId);
      }
    });
  });

  return io;
}

// ---------- Staff broadcasts ----------

export function emitToStaff(event, payload) {
  io?.to('staff').emit(event, payload);
}

function displayCount() {
  return io?.of('/').adapter.rooms.get('display')?.size ?? 0;
}

function broadcastDisplayPresence() {
  emitToStaff('display:presence', { count: displayCount() });
}

/** Broadcast a transaction change. `req` identifies who acted and from which browser tab. */
export function txUpdated(transaction, action, req) {
  emitToStaff('tx:updated', {
    transaction,
    action,
    by: req?.user ? { id: req.user.id, name: req.user.name } : null,
    clientId: cleanId(req?.get?.('x-client-id')),
  });
  if (display.txId === transaction.id) {
    if (transaction.status === 'pending') pushDisplay();
    else if (display.phase === 'payment') showResult(transaction);
  }
}

export function disconnectUser(userId) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}

export function disconnectSession(tokenHash) {
  io?.in(`session:${tokenHash}`).disconnectSockets(true);
}

export function disconnectDisplays() {
  io?.in('display').disconnectSockets(true);
}

// ---------- Live cart ----------

function sanitizeCartItems(items) {
  if (!Array.isArray(items) || items.length > 200) return null;
  const merged = new Map();
  for (const item of items) {
    const productId = Number(item?.productId);
    const qty = Number(item?.qty);
    if (!Number.isSafeInteger(productId) || productId < 1) return null;
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 9999) return null;
    merged.set(productId, Math.min((merged.get(productId) ?? 0) + qty, 9999));
  }
  return [...merged].map(([productId, qty]) => ({ productId, qty }));
}

/** The product whose quantity went up (to highlight it on the display), if any. */
function increasedProduct(before, after) {
  const prev = new Map(before.map((i) => [i.productId, i.qty]));
  return after.find((i) => i.qty > (prev.get(i.productId) ?? 0))?.productId ?? null;
}

function handleCartUpdate(socket, payload) {
  const items = sanitizeCartItems(payload?.items);
  const deviceId = socket.data.deviceId;
  if (!items || !deviceId) return;

  const guardedSince = checkedOut.get(deviceId);
  if (guardedSince !== undefined) {
    if (items.length === 0 || Date.now() - guardedSince > CHECKOUT_GUARD_MS) checkedOut.delete(deviceId);
    else return;
  }

  if (items.length === 0) {
    dropCartOf(deviceId);
    return;
  }

  const previous = liveCart?.deviceId === deviceId ? liveCart.items : [];
  liveCart = {
    deviceId,
    items,
    cashier: socket.data.user.name,
    rev: ++cartRev,
    lastChangedId: increasedProduct(previous, items),
  };
  // The cashier's latest action decides what the customer sees, so this also replaces
  // a payment or success screen. A pending payment can be brought back with "Ke Layar".
  clearTimeout(displayTimer);
  display = { phase: 'cart', txId: null };
  pushDisplay();
}

function dropCartOf(deviceId) {
  if (!liveCart || liveCart.deviceId !== deviceId) return;
  liveCart = null;
  if (display.phase === 'cart') clearDisplay();
}

/** Called when a transaction is created: that device's cart becomes the payment. */
export function cartCheckedOut(req) {
  const deviceId = cleanId(req?.get?.('x-client-id'));
  if (!deviceId) return;
  checkedOut.set(deviceId, Date.now());
  if (liveCart?.deviceId === deviceId) liveCart = null;
}

/** Re-send the cart (prices/names may have changed after a product edit). */
export function refreshDisplayCart() {
  if (display.phase === 'cart') pushDisplay();
}

function buildCart() {
  if (!liveCart) return null;
  const items = [];
  for (const { productId, qty } of liveCart.items) {
    const product = getProductLite(productId);
    if (product) items.push({ productId, name: product.name, price: product.price, qty, subtotal: product.price * qty });
  }
  if (items.length === 0) return null;
  return {
    items,
    itemCount: items.reduce((sum, i) => sum + i.qty, 0),
    total: items.reduce((sum, i) => sum + i.subtotal, 0),
    cashier: liveCart.cashier,
    rev: liveCart.rev,
    lastChangedId: liveCart.lastChangedId,
  };
}

// ---------- Customer display ----------

function publicTx(tx) {
  return {
    id: tx.id,
    code: tx.code,
    items: tx.items.map(({ name, price, qty, subtotal }) => ({ name, price, qty, subtotal })),
    itemCount: tx.itemCount,
    total: tx.total,
    method: tx.method,
    status: tx.status,
    qrisPayload: tx.method === 'qris' ? tx.qrisPayload : null,
    cashier: tx.createdBy.name,
    createdAt: tx.createdAt,
  };
}

export function buildDisplayState() {
  const store = { name: getStoreSettings().name };
  const empty = { store, phase: 'idle', cart: null, transaction: null, banks: [], qris: null };

  if (display.phase === 'cart') {
    const cart = buildCart();
    return cart ? { ...empty, phase: 'cart', cart } : empty;
  }

  const tx = display.txId ? getTx(display.txId) : null;
  if (!tx || display.phase === 'idle') return empty;
  let qris = null;
  if (tx.method === 'qris') {
    const info = getQrisInfo();
    qris = { merchantName: info.merchantName || '', nmid: info.nmid || null };
  }
  return {
    ...empty,
    phase: display.phase,
    transaction: publicTx(tx),
    banks: tx.method === 'transfer' ? listBanks() : [],
    qris,
  };
}

export function pushDisplay() {
  io?.to('display').emit('display:state', buildDisplayState());
}

export function showOnDisplay(txId) {
  clearTimeout(displayTimer);
  display = { phase: 'payment', txId };
  pushDisplay();
}

function showResult(tx) {
  clearTimeout(displayTimer);
  display = { phase: tx.status === 'paid' ? 'success' : 'cancelled', txId: tx.id };
  pushDisplay();
  displayTimer = setTimeout(() => {
    // Afterwards, show an order that is being rung up (if any), otherwise the welcome screen.
    display = liveCart ? { phase: 'cart', txId: null } : { phase: 'idle', txId: null };
    pushDisplay();
  }, RESULT_DURATION[tx.status] ?? 5000);
}

export function clearDisplay() {
  clearTimeout(displayTimer);
  display = { phase: 'idle', txId: null };
  pushDisplay();
}
