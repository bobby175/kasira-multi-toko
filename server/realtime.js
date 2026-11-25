// Real-time layer: staff devices and customer displays stay in sync per store via Socket.IO.
import { Server } from 'socket.io';
import { sessionFromCookieHeader, resolveActiveStore, rateLimit } from './auth.js';
import {
  getStoreSettings, getQrisInfo, listBanks, getTx, getProductLite, findStoreByDisplayKey, listStores,
} from './data.js';

let io = null;

// Per-store runtime state: { display: { phase, txId }, displayTimer, liveCart, cartRev }
const storeStates = new Map();

const RESULT_DURATION = { paid: 9000, cancelled: 5000 };

// Devices that just checked out: ignore a late "non-empty cart" message from them for a few seconds,
// so a delayed update can't replace the QR code that was just shown.
const checkedOut = new Map(); // `${storeId}:${deviceId}` -> timestamp
const CHECKOUT_GUARD_MS = 10_000;

const cleanId = (value) => String(value ?? '').replace(/[^\w-]/g, '').slice(0, 64) || null;
const staffRoom = (storeId) => `staff:${storeId}`;
const displayRoom = (storeId) => `display:${storeId}`;

function getState(storeId) {
  let s = storeStates.get(storeId);
  if (!s) {
    s = { display: { phase: 'idle', txId: null }, displayTimer: null, liveCart: null, cartRev: 0 };
    storeStates.set(storeId, s);
  }
  return s;
}

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
      const store = findStoreByDisplayKey(displayKey);
      if (!store) return next(new Error('INVALID_DISPLAY_KEY'));
      socket.data.kind = 'display';
      socket.data.storeId = store.id;
      return next();
    }

    const session = sessionFromCookieHeader(socket.handshake.headers.cookie);
    if (!session) return next(new Error('UNAUTHORIZED'));
    const store = resolveActiveStore(session.user, socket.handshake.auth?.storeId);
    if (!store) return next(new Error('NO_STORE'));
    socket.data.kind = 'staff';
    socket.data.user = session.user;
    socket.data.storeId = store.id;
    socket.data.tokenHash = session.tokenHash;
    socket.data.deviceId = cleanId(socket.handshake.auth?.deviceId);
    next();
  });

  io.on('connection', (socket) => {
    const storeId = socket.data.storeId;

    if (socket.data.kind === 'display') {
      socket.join(displayRoom(storeId));
      socket.emit('display:state', buildDisplayState(storeId));
      broadcastDisplayPresence(storeId);
      socket.on('disconnect', () => broadcastDisplayPresence(storeId));
      return; // displays are read-only: no event handlers
    }

    socket.join(staffRoom(storeId));
    socket.join(`user:${socket.data.user.id}`);
    socket.join(`session:${socket.data.tokenHash}`);
    if (socket.data.user.role === 'admin') socket.join('admins');
    socket.emit('display:presence', { count: displayCount(storeId) });

    socket.on('cart:update', (payload) => handleCartUpdate(socket, payload));
    socket.on('disconnect', (reason) => {
      // Logged out / app closed on purpose: take that device's cart off the customer display.
      // Network drops and page reloads keep it, since the cart is still on the device.
      if (reason === 'server namespace disconnect' || reason === 'client namespace disconnect') {
        dropCartOf(storeId, socket.data.deviceId);
      }
    });
  });

  return io;
}

// ---------- Staff broadcasts ----------

export function emitToStaff(storeId, event, payload) {
  if (storeId) io?.to(staffRoom(storeId)).emit(event, payload);
}

export function emitToAdmins(event, payload) {
  io?.to('admins').emit(event, payload);
}

export function emitSettingsChanged(storeId = null) {
  if (storeId) {
    emitToStaff(storeId, 'settings:changed');
    pushDisplay(storeId);
    return;
  }
  for (const s of listStores()) {
    emitToStaff(s.id, 'settings:changed');
    pushDisplay(s.id);
  }
}

export function emitStoresChanged() {
  emitToAdmins('stores:changed');
}

function displayCount(storeId) {
  return io?.of('/').adapter.rooms.get(displayRoom(storeId))?.size ?? 0;
}

function broadcastDisplayPresence(storeId) {
  emitToStaff(storeId, 'display:presence', { count: displayCount(storeId) });
}

/** Broadcast a transaction change to its store's staff and customer display. */
export function txUpdated(transaction, action, req) {
  const storeId = transaction.storeId;
  emitToStaff(storeId, 'tx:updated', {
    transaction,
    action,
    by: req?.user ? { id: req.user.id, name: req.user.name } : null,
    clientId: cleanId(req?.get?.('x-client-id')),
  });
  emitToAdmins('admin:tx', { storeId, txId: transaction.id, createdAt: transaction.createdAt, action });

  const state = getState(storeId);
  if (state.display.txId === transaction.id) {
    if (transaction.status === 'pending') pushDisplay(storeId);
    else if (state.display.phase === 'payment') showResult(storeId, transaction);
  }
}

export function disconnectUser(userId) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}

export function disconnectSession(tokenHash) {
  io?.in(`session:${tokenHash}`).disconnectSockets(true);
}

export function disconnectDisplays(storeId) {
  if (storeId) io?.in(displayRoom(storeId)).disconnectSockets(true);
}

export function cleanupStoreRealtime(storeId) {
  disconnectDisplays(storeId);
  const state = storeStates.get(storeId);
  if (state) {
    clearTimeout(state.displayTimer);
    storeStates.delete(storeId);
  }
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
  const storeId = socket.data.storeId;
  if (!items || !deviceId || !storeId) return;

  const guardKey = `${storeId}:${deviceId}`;
  const guardedSince = checkedOut.get(guardKey);
  if (guardedSince !== undefined) {
    if (items.length === 0 || Date.now() - guardedSince > CHECKOUT_GUARD_MS) checkedOut.delete(guardKey);
    else return;
  }

  if (items.length === 0) {
    dropCartOf(storeId, deviceId);
    return;
  }

  const state = getState(storeId);
  const previous = state.liveCart?.deviceId === deviceId ? state.liveCart.items : [];
  state.liveCart = {
    deviceId,
    items,
    cashier: socket.data.user.name,
    rev: ++state.cartRev,
    lastChangedId: increasedProduct(previous, items),
  };
  // The cashier's latest action decides what the customer sees, so this also replaces
  // a payment or success screen. A pending payment can be brought back with "Ke Layar".
  clearTimeout(state.displayTimer);
  state.display = { phase: 'cart', txId: null };
  pushDisplay(storeId);
}

function dropCartOf(storeId, deviceId) {
  const state = storeStates.get(storeId);
  if (!state || !state.liveCart || state.liveCart.deviceId !== deviceId) return;
  state.liveCart = null;
  if (state.display.phase === 'cart') clearDisplay(storeId);
}

/** Called when a transaction is created: that device's cart becomes the payment. */
export function cartCheckedOut(req) {
  const deviceId = cleanId(req?.get?.('x-client-id'));
  const storeId = req?.storeId;
  if (!deviceId || !storeId) return;
  checkedOut.set(`${storeId}:${deviceId}`, Date.now());
  const state = storeStates.get(storeId);
  if (state?.liveCart?.deviceId === deviceId) state.liveCart = null;
}

/** Re-send the cart (prices/names may have changed after a product edit). */
export function refreshDisplayCart(storeId) {
  const state = storeStates.get(storeId);
  if (state?.display.phase === 'cart') pushDisplay(storeId);
}

function buildCart(storeId) {
  const state = storeStates.get(storeId);
  if (!state?.liveCart) return null;
  const items = [];
  for (const { productId, qty } of state.liveCart.items) {
    const product = getProductLite(productId, storeId);
    if (product) items.push({ productId, name: product.name, price: product.price, qty, subtotal: product.price * qty });
  }
  if (items.length === 0) return null;
  return {
    items,
    itemCount: items.reduce((sum, i) => sum + i.qty, 0),
    total: items.reduce((sum, i) => sum + i.subtotal, 0),
    cashier: state.liveCart.cashier,
    rev: state.liveCart.rev,
    lastChangedId: state.liveCart.lastChangedId,
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

export function buildDisplayState(storeId) {
  const state = getState(storeId);
  const store = { name: getStoreSettings(storeId).name };
  const empty = { store, phase: 'idle', cart: null, transaction: null, banks: [], qris: null };

  if (state.display.phase === 'cart') {
    const cart = buildCart(storeId);
    return cart ? { ...empty, phase: 'cart', cart } : empty;
  }

  const tx = state.display.txId ? getTx(state.display.txId) : null;
  if (!tx || tx.storeId !== storeId || state.display.phase === 'idle') return empty;
  let qris = null;
  if (tx.method === 'qris') {
    const info = getQrisInfo(storeId);
    qris = { merchantName: info.merchantName || '', nmid: info.nmid || null };
  }
  return {
    ...empty,
    phase: state.display.phase,
    transaction: publicTx(tx),
    banks: tx.method === 'transfer' ? listBanks(storeId) : [],
    qris,
  };
}

export function pushDisplay(storeId) {
  if (storeId) io?.to(displayRoom(storeId)).emit('display:state', buildDisplayState(storeId));
}

export function showOnDisplay(storeId, txId) {
  const state = getState(storeId);
  clearTimeout(state.displayTimer);
  state.display = { phase: 'payment', txId };
  pushDisplay(storeId);
}

function showResult(storeId, tx) {
  const state = getState(storeId);
  clearTimeout(state.displayTimer);
  state.display = { phase: tx.status === 'paid' ? 'success' : 'cancelled', txId: tx.id };
  pushDisplay(storeId);
  state.displayTimer = setTimeout(() => {
    // Afterwards, show an order that is being rung up (if any), otherwise the welcome screen.
    state.display = state.liveCart ? { phase: 'cart', txId: null } : { phase: 'idle', txId: null };
    pushDisplay(storeId);
  }, RESULT_DURATION[tx.status] ?? 5000);
}

export function clearDisplay(storeId) {
  const state = getState(storeId);
  clearTimeout(state.displayTimer);
  state.display = { phase: 'idle', txId: null };
  pushDisplay(storeId);
}
