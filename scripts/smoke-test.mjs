// End-to-end API + realtime smoke test.
// Usage: start the server with DATA_DIR pointing to an empty temp folder, then
//   node scripts/smoke-test.mjs http://localhost:3999
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { crc16 } from '../server/qris.js';

const BASE = process.argv[2] || 'http://localhost:3999';

function client(clientId) {
  let cookie = '';
  let storeId = null;
  const call = async function call(method, path, body, extraHeaders = {}) {
    const res = await fetch(BASE + '/api' + path, {
      method,
      headers: {
        'X-Kasira': '1',
        ...(clientId ? { 'X-Client-Id': clientId } : {}),
        ...(storeId ? { 'X-Store-Id': String(storeId) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data, cookie };
  };
  call.setStore = (id) => {
    storeId = id;
  };
  return call;
}

const waitFor = (socket, event, predicate = () => true, ms = 4000) =>
  new Promise((resolve, reject) => {
    const where = new Error().stack.split('\n')[2]?.trim();
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event} (${where})`)), ms);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });

const admin = client('dev-admin');
const kasir = client('dev-kasir');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connected = (socket) =>
  new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });

// --- setup & auth
let r = await admin('GET', '/bootstrap');
assert.equal(r.data.needsSetup, true);
r = await admin('POST', '/setup', { storeName: 'Kopi Senja', name: 'Pemilik', username: 'admin', password: 'rahasia123' });
assert.equal(r.status, 201, JSON.stringify(r.data));
r = await admin('POST', '/setup', { storeName: 'X', name: 'X', username: 'x2', password: 'rahasia123' });
assert.equal(r.status, 409, 'second setup must be rejected');

// CSRF guard: missing header is rejected
const noHeader = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(noHeader.status, 403);

// --- users
r = await admin('POST', '/users', { name: 'Budi', username: 'budi', password: 'budi1234', role: 'karyawan' });
assert.equal(r.status, 201, JSON.stringify(r.data));
r = await kasir('POST', '/auth/login', { username: 'budi', password: 'salah' });
assert.equal(r.status, 401);
r = await kasir('POST', '/auth/login', { username: 'BUDI', password: 'budi1234' });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.user.role, 'karyawan');

// --- products: admin only
r = await admin('POST', '/products', { name: 'Kopi Susu', price: 18000, category: 'Minuman' });
assert.equal(r.status, 201);
const kopi = r.data.product;
r = await admin('POST', '/products', { name: 'Roti Bakar', price: 15000, category: 'Makanan' });
const roti = r.data.product;
r = await kasir('PUT', `/products/${kopi.id}`, { name: 'Kopi Susu', price: 1, category: 'Minuman' });
assert.equal(r.status, 403, 'karyawan must not edit price');
r = await kasir('POST', '/products', { name: 'Hack', price: 1 });
assert.equal(r.status, 403, 'karyawan must not add product');
r = await kasir('DELETE', `/products/${kopi.id}`);
assert.equal(r.status, 403, 'karyawan must not delete product');
r = await kasir('GET', '/products');
assert.equal(r.data.products.length, 2);

// --- payment config
const tlv = (t, v) => t + String(v.length).padStart(2, '0') + v;
const body =
  tlv('00', '01') + tlv('01', '11') +
  tlv('51', tlv('00', 'ID.CO.QRIS.WWW') + tlv('02', 'ID1020021181745') + tlv('03', 'UMI')) +
  tlv('52', '5812') + tlv('53', '360') + tlv('58', 'ID') + tlv('59', 'KOPI SENJA') + tlv('60', 'MEDAN') + '6304';
const staticQris = body + crc16(body);

r = await kasir('PUT', '/settings/qris', { payload: staticQris });
assert.equal(r.status, 403, 'karyawan must not change QRIS');
r = await admin('POST', '/settings/qris/analyze', { payload: staticQris });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.info.merchantName, 'KOPI SENJA');
r = await admin('PUT', '/settings/qris', { payload: staticQris });
assert.equal(r.data.qris.configured, true);
r = await admin('POST', '/settings/banks', { bankName: 'BCA', accountNumber: '1234567890', accountName: 'Kopi Senja' });
assert.equal(r.status, 201);

// --- realtime: staff socket (cookie) + customer display (key)
r = await kasir('GET', '/display');
const displayKey = r.data.key;
assert.match(displayKey, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

const badDisplay = io(BASE, { auth: { displayKey: 'WRONG-KEY1' }, reconnection: false });
const badErr = await new Promise((resolve) => badDisplay.on('connect_error', resolve));
assert.equal(badErr.message, 'INVALID_DISPLAY_KEY');
badDisplay.close();

const noAuth = io(BASE, { reconnection: false });
const noAuthErr = await new Promise((resolve) => noAuth.on('connect_error', resolve));
assert.equal(noAuthErr.message, 'UNAUTHORIZED');
noAuth.close();

const display = io(BASE, { auth: { displayKey: displayKey.toLowerCase() }, reconnection: false });
const idle = await waitFor(display, 'display:state');
assert.equal(idle.phase, 'idle');
assert.equal(idle.store.name, 'Kopi Senja');

const adminCookie = (await admin('GET', '/auth/me')).cookie;
const staff = io(BASE, { extraHeaders: { Cookie: adminCookie }, reconnection: false });
await new Promise((resolve, reject) => { staff.on('connect', resolve); staff.on('connect_error', reject); });

// --- create transaction as karyawan, client-sent price must be ignored
const createdEvt = waitFor(staff, 'tx:updated', (p) => p.action === 'created');
const paymentState = waitFor(display, 'display:state', (s) => s.phase === 'payment');
r = await kasir('POST', '/transactions', {
  method: 'qris',
  items: [{ productId: kopi.id, qty: 2, price: 1 }, { productId: roti.id, qty: 1 }],
});
assert.equal(r.status, 201, JSON.stringify(r.data));
const tx = r.data.transaction;
assert.equal(tx.total, 18000 * 2 + 15000);
assert.equal(tx.status, 'pending');
assert.match(tx.code, /^TRX-\d{6}-0001$/);
assert.ok(tx.qrisPayload.includes('5405' + '51000'), 'dynamic QRIS must embed the amount');
assert.ok(tx.qrisPayload.includes('010212'), 'dynamic QRIS must use POI 12');
assert.equal(tx.qrisPayload.slice(-4), crc16(tx.qrisPayload.slice(0, -4)));
const evt = await createdEvt;
assert.equal(evt.transaction.id, tx.id);
assert.equal(evt.by.name, 'Budi');
const shown = await paymentState;
assert.equal(shown.transaction.total, 51000);
assert.equal(shown.transaction.qrisPayload, tx.qrisPayload);
assert.equal(shown.qris.merchantName, 'KOPI SENJA');

// --- switch to bank transfer while pending
const transferState = waitFor(display, 'display:state', (s) => s.transaction?.method === 'transfer');
r = await kasir('POST', `/transactions/${tx.id}/method`, { method: 'transfer' });
assert.equal(r.status, 200);
const tState = await transferState;
assert.equal(tState.banks[0].accountNumber, '1234567890');

// --- display has no way to confirm: HTTP API without session is rejected
const anon = client();
r = await anon('POST', `/transactions/${tx.id}/confirm`);
assert.equal(r.status, 401, 'display/customer must not confirm');

// --- confirm by admin from another device; display shows success
const successState = waitFor(display, 'display:state', (s) => s.phase === 'success');
r = await admin('POST', `/transactions/${tx.id}/confirm`);
assert.equal(r.status, 200);
assert.equal(r.data.transaction.status, 'paid');
assert.equal(r.data.transaction.confirmedBy.name, 'Pemilik');
await successState;
r = await kasir('POST', `/transactions/${tx.id}/confirm`);
assert.equal(r.status, 409, 'double confirm must be rejected');
r = await kasir('POST', `/transactions/${tx.id}/cancel`);
assert.equal(r.status, 409, 'cannot cancel a paid transaction');

// --- history + summary
const start = new Date(); start.setHours(0, 0, 0, 0);
r = await kasir('GET', `/transactions?from=${start.getTime()}&to=${start.getTime() + 864e5}`);
assert.equal(r.data.transactions.length, 1);
assert.equal(r.data.summary.find((s) => s.status === 'paid').amount, 51000);

// --- users: karyawan cannot manage users; admin cannot remove the last admin
r = await kasir('GET', '/users');
assert.equal(r.status, 403);
const me = (await admin('GET', '/auth/me')).data.user;
r = await admin('PUT', `/users/${me.id}`, { name: 'Pemilik', username: 'admin', role: 'karyawan' });
assert.equal(r.status, 400);

// --- live cart mirrored to the customer display
let lastDisplay = null;
display.on('display:state', (s) => (lastDisplay = s));
const kasirCookie = (await kasir('GET', '/auth/me')).cookie;
const cashierSocket = io(BASE, { extraHeaders: { Cookie: kasirCookie }, auth: { deviceId: 'dev-kasir' }, reconnection: false });
const presence = new Promise((resolve) => cashierSocket.once('display:presence', resolve));
await connected(cashierSocket);
assert.ok((await presence).count >= 1, 'staff must see that a customer display is connected');
// The app empties the cart right after a checkout (this device checked out earlier in the test).
cashierSocket.emit('cart:update', { items: [] });

let cartState = waitFor(display, 'display:state', (s) => s.phase === 'cart');
cashierSocket.emit('cart:update', { items: [{ productId: kopi.id, qty: 2, price: 1, name: 'HACK' }] });
let shownCart = (await cartState).cart;
assert.equal(shownCart.items[0].name, 'Kopi Susu', 'names come from the database');
assert.equal(shownCart.items[0].price, 18000, 'prices come from the database');
assert.equal(shownCart.total, 36000);
assert.equal(shownCart.cashier, 'Budi');
assert.equal(shownCart.lastChangedId, kopi.id);

display.emit('cart:update', { items: [{ productId: roti.id, qty: 5 }] }); // displays are read-only
cashierSocket.emit('cart:update', { items: [{ productId: -1, qty: 1 }] }); // invalid -> ignored
cartState = waitFor(display, 'display:state', (s) => s.phase === 'cart' && s.cart.items.length === 2);
cashierSocket.emit('cart:update', { items: [{ productId: kopi.id, qty: 2 }, { productId: roti.id, qty: 1 }] });
shownCart = (await cartState).cart;
assert.equal(shownCart.total, 36000 + 15000);
assert.equal(shownCart.lastChangedId, roti.id, 'the newly added item is highlighted');
assert.equal(shownCart.items.find((i) => i.productId === roti.id).qty, 1, 'display socket must not change the cart');

cartState = waitFor(display, 'display:state', (s) => s.cart?.items.find((i) => i.productId === roti.id)?.price === 16000);
await admin('PUT', `/products/${roti.id}`, { name: 'Roti Bakar', price: 16000, category: 'Makanan' });
await cartState; // admin price edits show up immediately

// checkout from that device -> payment; a late cart message from it must not hide the QR
const payState = waitFor(display, 'display:state', (s) => s.phase === 'payment');
r = await kasir('POST', '/transactions', { method: 'transfer', items: [{ productId: kopi.id, qty: 2 }, { productId: roti.id, qty: 1 }] });
assert.equal(r.status, 201, JSON.stringify(r.data));
const tx2 = r.data.transaction;
await payState;
cashierSocket.emit('cart:update', { items: [{ productId: kopi.id, qty: 2 }, { productId: roti.id, qty: 1 }] });
cashierSocket.emit('cart:update', { items: [] });
await sleep(300);
assert.equal(lastDisplay.phase, 'payment');
assert.equal(lastDisplay.transaction.id, tx2.id);

// another device starts the next order -> display follows the latest action
const adminCartSocket = io(BASE, { extraHeaders: { Cookie: adminCookie }, auth: { deviceId: 'dev-admin-pc' }, reconnection: false });
await connected(adminCartSocket);
cartState = waitFor(display, 'display:state', (s) => s.phase === 'cart' && s.cart.cashier === 'Pemilik');
adminCartSocket.emit('cart:update', { items: [{ productId: kopi.id, qty: 1 }] });
await cartState;
cashierSocket.emit('cart:update', { items: [] }); // not the owner of the shown cart -> ignored
await sleep(300);
assert.equal(lastDisplay.phase, 'cart');

const idleAgain = waitFor(display, 'display:state', (s) => s.phase === 'idle');
adminCartSocket.close(); // closing the app takes its cart off the display
await idleAgain;

const backToPayment = waitFor(display, 'display:state', (s) => s.phase === 'payment' && s.transaction.id === tx2.id);
r = await kasir('POST', `/transactions/${tx2.id}/display`);
assert.equal(r.status, 200);
await backToPayment; // "Ke Layar" brings the pending payment back
r = await kasir('POST', `/transactions/${tx2.id}/cancel`);
assert.equal(r.status, 200);

// --- auto-confirm from forwarded payment notifications (manual still works)
r = await kasir('GET', '/settings/autoconfirm');
assert.equal(r.status, 403, 'only admin can see the webhook token');
r = await admin('GET', '/settings/autoconfirm');
assert.equal(r.data.enabled, false, 'auto-confirm is off by default');
const webhook = BASE + r.data.webhookPath;
const notify = async (url, text, type = 'text/plain') =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body: text }).then(async (res) => ({ status: res.status, data: await res.json() }));

let n = await notify(BASE + '/api/notify/wrong-token', 'Rp 1.000 masuk');
assert.equal(n.status, 404, 'wrong token is rejected');

// MacroDroid "Test actions" sends empty magic text: shows up as a connection test
n = await notify(webhook, '\n\n \n');
assert.equal(n.status, 200);
assert.equal(n.data.result, 'test');
r = await admin('GET', '/settings/autoconfirm');
assert.equal(r.data.recent[0].result, 'test', 'connection test is visible in the log');

const newTx = async (productId, qty) => (await kasir('POST', '/transactions', { method: 'qris', items: [{ productId, qty }] })).data.transaction;
const txA = await newTx(kopi.id, 3); // Rp 54.000
n = await notify(webhook, `GoPay Merchant\nPembayaran diterima\nRp${(54000).toLocaleString('id-ID')} dari pelanggan`);
assert.equal(n.data.result, 'would_confirm', 'while disabled it only reports what it would do');
assert.equal((await kasir('GET', `/transactions/${txA.id}`)).data.transaction.status, 'pending');

r = await admin('PUT', '/settings/autoconfirm', { enabled: true, windowMinutes: 30, ignoreWords: 'keluar, debit' });
assert.equal(r.data.enabled, true);

const autoEvt = waitFor(staff, 'tx:updated', (p) => p.action === 'confirmed' && p.transaction.id === txA.id);
const autoSuccess = waitFor(display, 'display:state', (s) => s.phase === 'success' && s.transaction.id === txA.id);
n = await notify(webhook, JSON.stringify({ app: 'GoPay Merchant', title: 'Pembayaran diterima', text: 'Rp54.000 dari pelanggan', time: '1763712000123' }), 'application/json');
assert.equal(n.data.result, 'confirmed', JSON.stringify(n.data));
assert.equal(n.data.transaction, txA.code);
const autoPaid = (await autoEvt).transaction;
assert.equal(autoPaid.status, 'paid');
assert.equal(autoPaid.confirmSource, 'auto');
assert.equal(autoPaid.confirmedBy.name, 'Otomatis');
await autoSuccess; // customer display shows "Pembayaran Berhasil"

n = await notify(webhook, JSON.stringify({ app: 'GoPay Merchant', title: 'Pembayaran diterima', text: 'Rp54.000 dari pelanggan', time: '1763712000123' }), 'application/json');
assert.equal(n.data.result, 'duplicate', 'the same notification is processed once');

n = await notify(webhook, 'BCA\nDana keluar Rp 15.000');
assert.equal(n.data.result, 'ignored', 'outgoing money is ignored');

// two pending payments with the same amount: never guess, ask staff
const txB = await newTx(kopi.id, 1);
const txC = await newTx(kopi.id, 1);
const attention = waitFor(staff, 'notify:attention');
n = await notify(webhook, 'DANA Bisnis\nKamu menerima Rp 18.000');
assert.equal(n.data.result, 'ambiguous');
assert.deepEqual((await attention).codes.sort(), [txB.code, txC.code].sort());
assert.equal((await kasir('GET', `/transactions/${txB.id}`)).data.transaction.status, 'pending');

// dry-run tester changes nothing
r = await admin('POST', '/settings/autoconfirm/test', { text: 'Rp 18.000 masuk' });
assert.equal(r.data.result, 'ambiguous');

// manual confirmation still works alongside auto-confirm
r = await kasir('POST', `/transactions/${txB.id}/confirm`);
assert.equal(r.data.transaction.confirmSource, 'manual');
n = await notify(webhook, 'DANA Bisnis\nKamu menerima Rp 18.000 (2)');
assert.equal(n.data.result, 'confirmed', 'only one candidate left now');
assert.equal(n.data.transaction, txC.code);

r = await admin('GET', '/settings/autoconfirm');
assert.ok(r.data.recent.some((x) => x.result === 'confirmed' && x.txCode === txA.code), 'notification log records the match');
const oldPath = r.data.webhookPath;
r = await admin('POST', '/settings/autoconfirm/regenerate');
assert.notEqual(r.data.webhookPath, oldPath);
const sharedWebhook = BASE + r.data.webhookPath;
n = await notify(BASE + oldPath, 'Rp 1.000 masuk');
assert.equal(n.status, 404, 'old token stops working after regenerate');

// --- multi-store: create Store #2 copying products & inheriting Pusat (Tetap) QRIS/Bank/Auto-Confirm
r = await admin('GET', '/stores');
assert.equal(r.data.stores.length, 1);
const store1 = r.data.stores[0];

r = await admin('POST', '/stores', {
  name: 'Kopi Senja Cabang 2',
  address: 'Jl. Merdeka 2',
  useSharedQris: true,
  useSharedBanks: true,
  useSharedAutoConfirm: true,
  copyProductsFromStoreId: store1.id,
});
assert.equal(r.status, 201, JSON.stringify(r.data));
const store2 = r.data.store;
assert.equal(r.data.stores.length, 2);

// Switch admin context to Store #2
admin.setStore(store2.id);
r = await admin('GET', '/products');
assert.equal(r.data.products.length, 2, 'products were copied to Store #2');
const kopi2 = r.data.products.find((p) => p.name === 'Kopi Susu');
assert.notEqual(kopi2.id, kopi.id, 'copied product has its own ID');

// Store #2 inherits Pusat QRIS, Bank, and Auto-Confirm
r = await admin('GET', '/settings');
assert.equal(r.data.qris.configured, true);
assert.equal(r.data.qris.useShared, true);
assert.equal(r.data.banks.length, 1);
assert.equal(r.data.banksMode.useShared, true);
assert.equal(r.data.autoConfirm.enabled, true);
assert.equal(r.data.autoConfirm.useShared, true);

// Store #2 has its own unique customer display key
r = await admin('GET', '/display');
const displayKey2 = r.data.key;
assert.notEqual(displayKey2, displayKey);
const display2 = io(BASE, { auth: { displayKey: displayKey2 }, reconnection: false });
const idle2 = await waitFor(display2, 'display:state');
assert.equal(idle2.store.name, 'Kopi Senja Cabang 2');

// Create karyawan locked to Store #2
r = await admin('POST', '/users', { name: 'Siti', username: 'siti', password: 'siti1234', role: 'karyawan', storeId: store2.id });
assert.equal(r.status, 201, JSON.stringify(r.data));
const sitiUser = r.data.user;
assert.equal(sitiUser.storeId, store2.id);

const kasir2 = client('dev-kasir-2');
r = await kasir2('POST', '/auth/login', { username: 'siti', password: 'siti1234' });
assert.equal(r.status, 200);
assert.equal(r.data.stores.length, 1);
assert.equal(r.data.stores[0].id, store2.id);

// Karyawan isolation: siti cannot spoof X-Store-Id to Store #1 or touch Store #1's products/txs
r = await kasir2('GET', '/products', undefined, { 'X-Store-Id': String(store1.id) });
assert.equal(r.data.products[0].storeId, store2.id, 'karyawan is strictly locked to assigned store');
r = await kasir2('POST', '/transactions', { method: 'qris', items: [{ productId: kopi.id, qty: 1 }] });
assert.equal(r.status, 409, 'Store #2 karyawan cannot ring up Store #1 product ID');
r = await kasir2('GET', `/transactions/${tx.id}`);
assert.equal(r.status, 404, 'Store #2 karyawan cannot view Store #1 transaction');

// Shared (Pusat) auto-confirm matches across branches safely
const pay2Evt = waitFor(display2, 'display:state', (s) => s.phase === 'payment');
r = await kasir2('POST', '/transactions', { method: 'qris', items: [{ productId: kopi2.id, qty: 2 }] }); // Rp 36.000
assert.equal(r.status, 201, JSON.stringify(r.data));
const txS2 = r.data.transaction;
assert.equal(txS2.storeId, store2.id);
await pay2Evt;

const success2Evt = waitFor(display2, 'display:state', (s) => s.phase === 'success' && s.transaction.id === txS2.id);
n = await notify(sharedWebhook, 'DANA Bisnis\nDana masuk Rp 36.000 (cabang 2)');
assert.equal(n.data.result, 'confirmed', JSON.stringify(n.data));
assert.equal(n.data.transaction, txS2.code);
await success2Evt;

// Ambiguous across two branches sharing Pusat auto-confirm: never guesses
const txS1Amb = await newTx(kopi.id, 1); // Rp 18.000 in Store #1
const txS2Amb = (await kasir2('POST', '/transactions', { method: 'qris', items: [{ productId: kopi2.id, qty: 1 }] })).data.transaction; // Rp 18.000 in Store #2
n = await notify(sharedWebhook, 'DANA Bisnis\nTerima Rp 18.000 lintas cabang');
assert.equal(n.data.result, 'ambiguous', 'same amount pending in two branches must be ambiguous on shared webhook');

// Switch Store #2 to Khusus Toko Ini (dedicated QRIS, Bank, Auto-Confirm)
r = await admin('PUT', '/settings/payment-mode', { feature: 'qris', useShared: false });
assert.equal(r.data.qris.useShared, false);
assert.equal(r.data.qris.configured, false, 'Store #2 has no custom QRIS yet');
r = await admin('PUT', '/settings/payment-mode', { feature: 'banks', useShared: false });
assert.equal(r.data.banksMode.useShared, false);
assert.equal(r.data.banks.length, 0);
r = await admin('PUT', '/settings/payment-mode', { feature: 'autoconfirm', useShared: false });
assert.equal(r.data.autoConfirm.useShared, false);
assert.equal(r.data.autoConfirm.enabled, false);

// Configure dedicated QRIS, Bank, and Auto-Confirm for Store #2
const body2 =
  tlv('00', '01') + tlv('01', '11') +
  tlv('51', tlv('00', 'ID.CO.QRIS.WWW') + tlv('02', 'ID1020021181746') + tlv('03', 'UMI')) +
  tlv('52', '5812') + tlv('53', '360') + tlv('58', 'ID') + tlv('59', 'CABANG DUA') + tlv('60', 'BANDUNG') + '6304';
const staticQris2 = body2 + crc16(body2);
r = await admin('PUT', '/settings/qris', { payload: staticQris2 });
assert.equal(r.data.qris.merchantName, 'CABANG DUA');
r = await admin('POST', '/settings/banks', { bankName: 'BRI', accountNumber: '9876543210', accountName: 'Cabang Dua' });
assert.equal(r.status, 201);
r = await admin('PUT', '/settings/autoconfirm', { enabled: true, windowMinutes: 30, ignoreWords: 'keluar, debit' });
const store2Webhook = BASE + r.data.webhookPath;
assert.notEqual(store2Webhook, sharedWebhook, 'Store #2 has its own dedicated webhook URL');

// Now Rp 18.000 on Store #2's dedicated webhook confirms ONLY txS2Amb (unambiguous within Store #2!)
n = await notify(store2Webhook, 'GoPay Merchant\nPembayaran Rp 18.000 cabang 2 khusus');
assert.equal(n.data.result, 'confirmed', JSON.stringify(n.data));
assert.equal(n.data.transaction, txS2Amb.code);
assert.equal((await kasir('GET', `/transactions/${txS1Amb.id}`)).data.transaction.status, 'pending', 'Store #1 tx remains untouched');
await kasir('POST', `/transactions/${txS1Amb.id}/cancel`);

// Verify Store #1 Pusat QRIS & Bank were not affected by Store #2's dedicated settings
admin.setStore(store1.id);
r = await admin('GET', '/settings');
assert.equal(r.data.qris.merchantName, 'KOPI SENJA');
assert.equal(r.data.banks[0].bankName, 'BCA');

// Combined all-stores history for admin vs store-scoped history for karyawan
r = await admin('GET', `/transactions?store=all&from=${start.getTime()}&to=${start.getTime() + 864e5}`);
assert.ok(r.data.transactions.some((t) => t.storeId === store1.id), 'admin all-stores includes Store #1');
assert.ok(r.data.transactions.some((t) => t.storeId === store2.id), 'admin all-stores includes Store #2');
r = await kasir2('GET', `/transactions?store=all&from=${start.getTime()}&to=${start.getTime() + 864e5}`);
assert.ok(r.data.transactions.every((t) => t.storeId === store2.id), 'karyawan cannot bypass store filter with store=all');

// Store deletion guard (blocked while karyawan assigned, allowed after removing karyawan; cannot delete last store)
r = await admin('DELETE', `/stores/${store2.id}`);
assert.equal(r.status, 400, 'cannot delete store with assigned karyawan');
r = await admin('DELETE', `/users/${sitiUser.id}`);
assert.equal(r.status, 200);
r = await admin('DELETE', `/stores/${store2.id}`);
assert.equal(r.status, 200);
assert.equal(r.data.stores.length, 1);
r = await admin('DELETE', `/stores/${store1.id}`);
assert.equal(r.status, 400, 'cannot delete the last remaining store');

display2.close();
cashierSocket.close();
display.close();
staff.close();
console.log('SMOKE TEST OK');
process.exit(0);
