// Shared data-access helpers used by routes and the realtime layer.
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';
import { analyzeQris } from './qris.js';

// ---------- Store settings ----------

export function getStoreSettings() {
  return {
    name: getSetting('store_name', 'Toko Saya'),
    address: getSetting('store_address', ''),
    phone: getSetting('store_phone', ''),
    footer: getSetting('receipt_footer', 'Terima kasih atas kunjungan Anda!'),
    paperWidth: Number(getSetting('paper_width', '58')) === 80 ? 80 : 58,
  };
}

export function getQrisInfo() {
  const payload = getSetting('qris_payload');
  if (!payload) return { configured: false };
  try {
    const info = analyzeQris(payload);
    return {
      configured: true,
      merchantName: info.merchantName,
      merchantCity: info.merchantCity,
      nmid: info.nmid,
    };
  } catch {
    return { configured: false };
  }
}

// ---------- Bank accounts ----------

const listBanksStmt = db.prepare('SELECT * FROM bank_accounts ORDER BY id ASC');

export const serializeBank = (row) => ({
  id: row.id,
  bankName: row.bank_name,
  accountNumber: row.account_number,
  accountName: row.account_name,
});

export function listBanks() {
  return listBanksStmt.all().map(serializeBank);
}

// ---------- Display (customer screen) key ----------

const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const normalizeDisplayKey = (key) => String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function regenerateDisplayKey() {
  let key = '';
  for (let i = 0; i < 8; i++) key += KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)];
  setSetting('display_key', key);
  return key;
}

export function getDisplayKey() {
  return getSetting('display_key') || regenerateDisplayKey();
}

export const formatDisplayKey = (key) => `${key.slice(0, 4)}-${key.slice(4)}`;

export function isValidDisplayKey(candidate) {
  const a = Buffer.from(normalizeDisplayKey(candidate));
  const b = Buffer.from(getDisplayKey());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Products ----------

export const serializeProduct = (row) => ({
  id: row.id,
  name: row.name,
  price: row.price,
  category: row.category,
  image: row.image ? `/uploads/${row.image}` : null,
  updatedAt: row.updated_at,
});

const getProductLiteStmt = db.prepare('SELECT id, name, price FROM products WHERE id = ?');

export function getProductLite(id) {
  return getProductLiteStmt.get(id) ?? null;
}

// ---------- Transactions ----------

const getTxStmt = db.prepare('SELECT * FROM transactions WHERE id = ?');

export function serializeTx(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    items: JSON.parse(row.items),
    itemCount: row.item_count,
    total: row.total,
    method: row.method,
    status: row.status,
    qrisPayload: row.qris_payload,
    createdBy: { id: row.created_by, name: row.created_by_name },
    confirmedBy: row.confirmed_by_name ? { id: row.confirmed_by, name: row.confirmed_by_name } : null,
    confirmSource: row.confirm_source || (row.confirmed_at ? 'manual' : null),
    confirmNote: row.confirm_note || null,
    cancelledBy: row.cancelled_by_name ? { id: row.cancelled_by, name: row.cancelled_by_name } : null,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
  };
}

export function getTx(id) {
  return serializeTx(getTxStmt.get(id));
}
