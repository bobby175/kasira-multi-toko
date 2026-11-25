import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { db, inTransaction, UPLOAD_DIR, DEFAULT_STORE_FOOTER } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { createStoreRecord, getStoreRowStrict, listStores, serializeStore } from '../data.js';
import { cleanupStoreRealtime, emitSettingsChanged, emitStoresChanged } from '../realtime.js';
import { httpError, str, parseId } from '../util.js';

function copyProductImage(filename) {
  if (!filename || !/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) return null;
  const src = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(src)) return null;
  const ext = path.extname(filename);
  const next = `${crypto.randomUUID()}${ext}`;
  fs.copyFileSync(src, path.join(UPLOAD_DIR, next));
  return next;
}

function removeImage(filename) {
  if (filename && /^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) {
    fs.rm(path.join(UPLOAD_DIR, filename), { force: true }, () => {});
  }
}

const countStoresStmt = db.prepare('SELECT COUNT(*) AS n FROM stores');
const countStoreStaffStmt = db.prepare("SELECT COUNT(*) AS n FROM users WHERE store_id = ? AND role = 'karyawan'");
const listStoreProductsStmt = db.prepare('SELECT * FROM products WHERE store_id = ? ORDER BY id ASC');
const insertProductStmt = db.prepare(
  'INSERT INTO products (store_id, name, price, category, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);

const router = Router();

router.get('/', requireAuth, (req, res) => {
  if (req.user.role === 'admin') {
    return res.json({ stores: listStores() });
  }
  const mine = listStores().filter((s) => s.id === req.storeId);
  res.json({ stores: mine });
});

router.post('/', requireAdmin, (req, res) => {
  const body = req.body ?? {};
  const name = str(body.name, { field: 'Nama toko', required: true, max: 60 });
  const address = str(body.address, { field: 'Alamat', max: 160 });
  const phone = str(body.phone, { field: 'Telepon', max: 30 });
  const footer = str(body.footer ?? DEFAULT_STORE_FOOTER, { field: 'Catatan struk', max: 160 });
  const paperWidth = Number(body.paperWidth) === 80 ? 80 : 58;
  const useSharedQris = body.useSharedQris === undefined ? true : Boolean(body.useSharedQris);
  const useSharedBanks = body.useSharedBanks === undefined ? true : Boolean(body.useSharedBanks);
  const useSharedAutoConfirm = body.useSharedAutoConfirm === undefined ? true : Boolean(body.useSharedAutoConfirm);
  const copyFromId = body.copyProductsFromStoreId ? parseId(body.copyProductsFromStoreId, 'Toko sumber') : null;

  if (copyFromId && !getStoreRowStrict(copyFromId)) {
    throw httpError(404, 'Toko sumber produk tidak ditemukan');
  }

  const created = inTransaction(() => {
    const store = createStoreRecord({
      name,
      address,
      phone,
      footer,
      paperWidth,
      useSharedQris,
      useSharedBanks,
      useSharedAutoConfirm,
    });
    if (copyFromId) {
      const now = Date.now();
      for (const p of listStoreProductsStmt.all(copyFromId)) {
        const img = copyProductImage(p.image);
        insertProductStmt.run(store.id, p.name, p.price, p.category, img, now, now);
      }
    }
    return store;
  });

  emitStoresChanged();
  res.status(201).json({ store: serializeStore(created), stores: listStores() });
});

router.put('/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const existing = getStoreRowStrict(id);
  if (!existing) throw httpError(404, 'Toko tidak ditemukan');

  const body = req.body ?? {};
  const name = str(body.name ?? existing.name, { field: 'Nama toko', required: true, max: 60 });
  const address = str(body.address ?? existing.address, { field: 'Alamat', max: 160 });
  const phone = str(body.phone ?? existing.phone, { field: 'Telepon', max: 30 });
  const footer = str(body.footer ?? existing.receipt_footer, { field: 'Catatan struk', max: 160 });
  const paperWidth = body.paperWidth === undefined ? existing.paper_width : Number(body.paperWidth) === 80 ? 80 : 58;
  const useSharedQris = body.useSharedQris === undefined ? existing.use_shared_qris : body.useSharedQris ? 1 : 0;
  const useSharedBanks = body.useSharedBanks === undefined ? existing.use_shared_banks : body.useSharedBanks ? 1 : 0;
  const useSharedAutoConfirm =
    body.useSharedAutoConfirm === undefined ? existing.use_shared_autoconfirm : body.useSharedAutoConfirm ? 1 : 0;

  db.prepare(`
    UPDATE stores
    SET name = ?, address = ?, phone = ?, receipt_footer = ?, paper_width = ?,
        use_shared_qris = ?, use_shared_banks = ?, use_shared_autoconfirm = ?
    WHERE id = ?
  `).run(name, address, phone, footer, paperWidth, useSharedQris, useSharedBanks, useSharedAutoConfirm, id);

  emitSettingsChanged(id);
  emitStoresChanged();
  res.json({ store: serializeStore(getStoreRowStrict(id)), stores: listStores() });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const existing = getStoreRowStrict(id);
  if (!existing) throw httpError(404, 'Toko tidak ditemukan');
  if (countStoresStmt.get().n <= 1) {
    throw httpError(400, 'Minimal harus ada satu toko.');
  }
  if (countStoreStaffStmt.get(id).n > 0) {
    throw httpError(400, 'Masih ada karyawan yang ditugaskan di toko ini. Pindahkan atau hapus karyawan terlebih dahulu.');
  }

  const images = db.prepare('SELECT image FROM products WHERE store_id = ? AND image IS NOT NULL').all(id).map((r) => r.image);
  db.prepare('DELETE FROM stores WHERE id = ?').run(id);
  for (const img of images) removeImage(img);

  cleanupStoreRealtime(id);
  emitStoresChanged();
  res.json({ ok: true, stores: listStores() });
});

export default router;
