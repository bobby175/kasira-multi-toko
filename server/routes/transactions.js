import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { getEffectiveQrisPayload, getTx, serializeTx, listBanks } from '../data.js';
import { toDynamicQris } from '../qris.js';
import { txUpdated, showOnDisplay, cartCheckedOut } from '../realtime.js';
import { httpError, int, parseId } from '../util.js';

const METHODS = ['qris', 'transfer'];
const STATUSES = ['pending', 'paid', 'cancelled'];
const MAX_TOTAL = 999_999_999_999;

const getProductStmt = db.prepare('SELECT id, name, price FROM products WHERE id = ? AND store_id = ?');
const lastCodeStmt = db.prepare('SELECT code FROM transactions WHERE code LIKE ? ORDER BY id DESC LIMIT 1');
const insertTxStmt = db.prepare(`
  INSERT INTO transactions
    (store_id, code, items, item_count, total, method, status, qris_payload, created_by, created_by_name, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
`);

const pad = (n) => String(n).padStart(2, '0');

function nextCode(date = new Date()) {
  const prefix = `TRX-${String(date.getFullYear()).slice(2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}-`;
  const last = lastCodeStmt.get(`${prefix}%`);
  const seq = last ? Number(last.code.slice(prefix.length)) + 1 : 1;
  return prefix + String(seq).padStart(4, '0');
}

/** Validate the payment method is configured for this store and return the QRIS payload (if any). */
function preparePayment(storeId, method, total) {
  if (!METHODS.includes(method)) throw httpError(400, 'Metode pembayaran tidak valid');
  if (method === 'qris') {
    const staticQris = getEffectiveQrisPayload(storeId);
    if (!staticQris) throw httpError(400, 'QRIS belum diatur. Minta admin mengunggah QRIS di Pengaturan.');
    return toDynamicQris(staticQris, total);
  }
  if (listBanks(storeId).length === 0) {
    throw httpError(400, 'Rekening bank belum diatur. Minta admin menambahkan rekening di Pengaturan.');
  }
  return null;
}

function loadTxForReq(id, req) {
  const tx = getTx(id);
  if (!tx) throw httpError(404, 'Transaksi tidak ditemukan');
  if (req.user.role !== 'admin' && tx.storeId !== req.storeId) {
    throw httpError(404, 'Transaksi tidak ditemukan');
  }
  return tx;
}

function conflictMessage(tx) {
  if (tx.status === 'paid') return `Transaksi ini sudah dikonfirmasi lunas oleh ${tx.confirmedBy?.name ?? 'staf lain'}.`;
  return `Transaksi ini sudah dibatalkan oleh ${tx.cancelledBy?.name ?? 'staf lain'}.`;
}

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const where = [];
  const params = [];
  const { status, q, store } = req.query;

  const allStores = req.user.role === 'admin' && store === 'all';
  if (!allStores) {
    where.push('t.store_id = ?');
    params.push(req.storeId);
  }

  if (typeof status === 'string' && STATUSES.includes(status)) {
    where.push('t.status = ?');
    params.push(status);
  }
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  const hasRange = Number.isFinite(from) && Number.isFinite(to) && to > from;
  if (hasRange) {
    where.push('t.created_at >= ? AND t.created_at < ?');
    params.push(from, to);
  }
  if (typeof q === 'string' && q.trim()) {
    where.push("t.code LIKE ? ESCAPE '\\'");
    params.push(`%${q.trim().slice(0, 40).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  const before = Number(req.query.before);
  if (Number.isSafeInteger(before) && before > 0) {
    where.push('t.id < ?');
    params.push(before);
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const rows = db
    .prepare(`
      SELECT t.*, s.name AS store_name
      FROM transactions t
      LEFT JOIN stores s ON s.id = t.store_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.id DESC LIMIT ?
    `)
    .all(...params, limit + 1);

  let summary = null;
  if (hasRange) {
    const sumSql = allStores
      ? `
        SELECT status, method, COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount
        FROM transactions WHERE created_at >= ? AND created_at < ?
        GROUP BY status, method
      `
      : `
        SELECT status, method, COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount
        FROM transactions WHERE store_id = ? AND created_at >= ? AND created_at < ?
        GROUP BY status, method
      `;
    summary = allStores
      ? db.prepare(sumSql).all(from, to)
      : db.prepare(sumSql).all(req.storeId, from, to);
  }

  res.json({
    transactions: rows.slice(0, limit).map(serializeTx),
    hasMore: rows.length > limit,
    summary,
  });
});

router.get('/pending', (req, res) => {
  const rows = db
    .prepare(`
      SELECT t.*, s.name AS store_name
      FROM transactions t
      LEFT JOIN stores s ON s.id = t.store_id
      WHERE t.store_id = ? AND t.status = 'pending'
      ORDER BY t.id DESC LIMIT 100
    `)
    .all(req.storeId);
  res.json({ transactions: rows.map(serializeTx) });
});

router.get('/:id', (req, res) => {
  res.json({ transaction: loadTxForReq(parseId(req.params.id), req) });
});

router.post('/', (req, res) => {
  const { items, method } = req.body ?? {};
  if (!Array.isArray(items) || items.length === 0) throw httpError(400, 'Keranjang masih kosong');
  if (items.length > 200) throw httpError(400, 'Terlalu banyak jenis item dalam satu transaksi');

  // Prices always come from the database for the active store, never from the client.
  const qtyByProduct = new Map();
  for (const item of items) {
    const productId = int(item?.productId, { field: 'Produk', min: 1 });
    const qty = int(item?.qty, { field: 'Jumlah', min: 1, max: 9999 });
    qtyByProduct.set(productId, (qtyByProduct.get(productId) ?? 0) + qty);
  }
  const lines = [];
  for (const [productId, qty] of qtyByProduct) {
    const product = getProductStmt.get(productId, req.storeId);
    if (!product) throw httpError(409, 'Ada produk di keranjang yang sudah dihapus. Periksa kembali keranjang.');
    lines.push({ productId, name: product.name, price: product.price, qty, subtotal: product.price * qty });
  }
  const total = lines.reduce((sum, l) => sum + l.subtotal, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.qty, 0);
  if (total <= 0) throw httpError(400, 'Total transaksi harus lebih dari Rp 0');
  if (total > MAX_TOTAL) throw httpError(400, 'Total transaksi terlalu besar');

  const qrisPayload = preparePayment(req.storeId, method, total);
  const info = insertTxStmt.run(
    req.storeId, nextCode(), JSON.stringify(lines), itemCount, total, method, qrisPayload,
    req.user.id, req.user.name, Date.now()
  );
  const tx = getTx(Number(info.lastInsertRowid));
  cartCheckedOut(req);
  showOnDisplay(tx.storeId, tx.id);
  txUpdated(tx, 'created', req);
  res.status(201).json({ transaction: tx });
});

router.post('/:id/method', (req, res) => {
  const id = parseId(req.params.id);
  const tx = loadTxForReq(id, req);
  if (tx.status !== 'pending') throw httpError(409, conflictMessage(tx));
  const method = req.body?.method;
  const qrisPayload = preparePayment(tx.storeId, method, tx.total);
  db.prepare("UPDATE transactions SET method = ?, qris_payload = ? WHERE id = ? AND status = 'pending'").run(
    method, qrisPayload, id
  );
  const updated = getTx(id);
  txUpdated(updated, 'method', req);
  res.json({ transaction: updated });
});

router.post('/:id/confirm', (req, res) => {
  const id = parseId(req.params.id);
  const existing = loadTxForReq(id, req);
  const result = db
    .prepare(`
      UPDATE transactions SET status = 'paid', confirmed_by = ?, confirmed_by_name = ?, confirmed_at = ?, confirm_source = 'manual'
      WHERE id = ? AND status = 'pending'
    `)
    .run(req.user.id, req.user.name, Date.now(), existing.id);
  const tx = getTx(existing.id);
  if (result.changes === 0) throw httpError(409, conflictMessage(tx));
  txUpdated(tx, 'confirmed', req);
  res.json({ transaction: tx });
});

router.post('/:id/cancel', (req, res) => {
  const id = parseId(req.params.id);
  const existing = loadTxForReq(id, req);
  const result = db
    .prepare(`
      UPDATE transactions SET status = 'cancelled', cancelled_by = ?, cancelled_by_name = ?, cancelled_at = ?
      WHERE id = ? AND status = 'pending'
    `)
    .run(req.user.id, req.user.name, Date.now(), existing.id);
  const tx = getTx(existing.id);
  if (result.changes === 0) throw httpError(409, conflictMessage(tx));
  txUpdated(tx, 'cancelled', req);
  res.json({ transaction: tx });
});

router.post('/:id/display', (req, res) => {
  const tx = loadTxForReq(parseId(req.params.id), req);
  if (tx.status !== 'pending') throw httpError(409, conflictMessage(tx));
  showOnDisplay(tx.storeId, tx.id);
  res.json({ ok: true });
});

export default router;
