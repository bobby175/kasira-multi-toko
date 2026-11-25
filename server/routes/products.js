import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { db, UPLOAD_DIR } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { serializeProduct } from '../data.js';
import { emitToStaff, emitStoresChanged, refreshDisplayCart } from '../realtime.js';
import { httpError, str, int, parseId } from '../util.js';

function productsChanged(storeId) {
  emitToStaff(storeId, 'products:changed');
  refreshDisplayCart(storeId);
  emitStoresChanged();
}

const MAX_PRICE = 1_000_000_000;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function looksLikeImage(mime, buf) {
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') return buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === 'image/webp') {
    return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function saveImage(dataUrl) {
  if (typeof dataUrl !== 'string') throw httpError(400, 'Gambar tidak valid');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw httpError(400, 'Format gambar harus JPG, PNG, atau WEBP');
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw httpError(413, 'Ukuran gambar maksimal 1,5 MB');
  if (!looksLikeImage(match[1], buf)) throw httpError(400, 'File gambar rusak atau tidak valid');
  const filename = `${crypto.randomUUID()}.${IMAGE_EXT[match[1]]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  return filename;
}

function removeImage(filename) {
  if (filename && /^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) {
    fs.rm(path.join(UPLOAD_DIR, filename), { force: true }, () => {});
  }
}

function readProductInput(body) {
  return {
    name: str(body?.name, { field: 'Nama produk', required: true, max: 80 }),
    price: int(body?.price, { field: 'Harga', min: 0, max: MAX_PRICE }),
    category: str(body?.category, { field: 'Kategori', max: 40 }),
  };
}

const listStmt = db.prepare('SELECT * FROM products WHERE store_id = ? ORDER BY category COLLATE NOCASE, name COLLATE NOCASE');
const getStmt = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?');

const router = Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ products: listStmt.all(req.storeId).map(serializeProduct) });
});

router.post('/', requireAdmin, (req, res) => {
  const input = readProductInput(req.body);
  const image = req.body?.image ? saveImage(req.body.image) : null;
  const now = Date.now();
  const info = db
    .prepare('INSERT INTO products (store_id, name, price, category, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.storeId, input.name, input.price, input.category, image, now, now);
  const product = serializeProduct(getStmt.get(Number(info.lastInsertRowid), req.storeId));
  productsChanged(req.storeId);
  res.status(201).json({ product });
});

router.put('/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const existing = getStmt.get(id, req.storeId);
  if (!existing) throw httpError(404, 'Produk tidak ditemukan');
  const input = readProductInput(req.body);

  // image: undefined = keep, null/"" = remove, data URL = replace
  let image = existing.image;
  if (req.body?.image === null || req.body?.image === '') image = null;
  else if (typeof req.body?.image === 'string' && req.body.image.startsWith('data:')) image = saveImage(req.body.image);

  db.prepare('UPDATE products SET name = ?, price = ?, category = ?, image = ?, updated_at = ? WHERE id = ? AND store_id = ?').run(
    input.name, input.price, input.category, image, Date.now(), id, req.storeId
  );
  if (image !== existing.image) removeImage(existing.image);
  productsChanged(req.storeId);
  res.json({ product: serializeProduct(getStmt.get(id, req.storeId)) });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const existing = getStmt.get(id, req.storeId);
  if (!existing) throw httpError(404, 'Produk tidak ditemukan');
  db.prepare('DELETE FROM products WHERE id = ? AND store_id = ?').run(id, req.storeId);
  removeImage(existing.image);
  productsChanged(req.storeId);
  res.json({ ok: true });
});

export default router;
