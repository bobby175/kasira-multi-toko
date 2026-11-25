// Shared data-access helpers used by routes and the realtime layer.
import crypto from 'node:crypto';
import {
  db, getSetting, DEFAULT_STORE_FOOTER, DEFAULT_IGNORE_WORDS, randomDisplayKey, randomNotifyToken,
} from './db.js';
import { analyzeQris } from './qris.js';

// ---------- Stores ----------

const listStoresStmt = db.prepare(`
  SELECT s.*,
    (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS product_count,
    (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id AND u.role = 'karyawan') AS staff_count,
    (SELECT COUNT(*) FROM transactions t WHERE t.store_id = s.id AND t.status = 'pending') AS pending_count
  FROM stores s
  ORDER BY s.id ASC
`);
const getStoreStmt = db.prepare('SELECT * FROM stores WHERE id = ?');
const getFirstStoreStmt = db.prepare('SELECT * FROM stores ORDER BY id ASC LIMIT 1');
const findDisplayKeyStmt = db.prepare('SELECT id FROM stores WHERE display_key = ?');
const findNotifyTokenStmt = db.prepare('SELECT id FROM stores WHERE notify_token = ?');

export function generateUniqueDisplayKey() {
  for (let i = 0; i < 20; i++) {
    const key = randomDisplayKey();
    if (!findDisplayKeyStmt.get(key)) return key;
  }
  return randomDisplayKey();
}

export function generateUniqueNotifyToken() {
  const shared = getSetting('notify_token');
  for (let i = 0; i < 20; i++) {
    const token = randomNotifyToken();
    if (token !== shared && !findNotifyTokenStmt.get(token)) return token;
  }
  return randomNotifyToken();
}

export const serializeStore = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    footer: row.receipt_footer,
    paperWidth: Number(row.paper_width) === 80 ? 80 : 58,
    useSharedQris: Boolean(row.use_shared_qris),
    useSharedBanks: Boolean(row.use_shared_banks),
    useSharedAutoConfirm: Boolean(row.use_shared_autoconfirm),
    createdAt: row.created_at,
    ...(row.product_count !== undefined
      ? {
          counts: {
            products: row.product_count,
            staff: row.staff_count,
            pending: row.pending_count,
          },
        }
      : {}),
  };
};

export function listStores() {
  return listStoresStmt.all().map(serializeStore);
}

export function getStoreRow(storeId) {
  if (storeId) {
    const row = getStoreStmt.get(storeId);
    if (row) return row;
  }
  return getFirstStoreStmt.get() ?? null;
}

export function getStoreRowStrict(storeId) {
  return storeId ? getStoreStmt.get(storeId) ?? null : null;
}

export function createStoreRecord({
  name,
  address = '',
  phone = '',
  footer = DEFAULT_STORE_FOOTER,
  paperWidth = 58,
  useSharedQris = true,
  useSharedBanks = true,
  useSharedAutoConfirm = true,
}) {
  const info = db
    .prepare(`
      INSERT INTO stores (
        name, address, phone, receipt_footer, paper_width, display_key,
        use_shared_qris, use_shared_banks, use_shared_autoconfirm,
        autoconfirm_enabled, autoconfirm_window, autoconfirm_ignore, notify_token, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 30, ?, ?, ?)
    `)
    .run(
      name,
      address,
      phone,
      footer,
      Number(paperWidth) === 80 ? 80 : 58,
      generateUniqueDisplayKey(),
      useSharedQris ? 1 : 0,
      useSharedBanks ? 1 : 0,
      useSharedAutoConfirm ? 1 : 0,
      DEFAULT_IGNORE_WORDS,
      generateUniqueNotifyToken(),
      Date.now()
    );
  return getStoreStmt.get(Number(info.lastInsertRowid));
}

// ---------- Store settings ----------

export function getStoreSettings(storeId = null) {
  const store = getStoreRow(storeId);
  if (!store) {
    return {
      id: null,
      name: getSetting('store_name', 'Toko Saya'),
      address: '',
      phone: '',
      footer: DEFAULT_STORE_FOOTER,
      paperWidth: 58,
      useSharedQris: true,
      useSharedBanks: true,
      useSharedAutoConfirm: true,
    };
  }
  return serializeStore(store);
}

export function getEffectiveQrisPayload(storeId = null) {
  const store = getStoreRow(storeId);
  if (!store || store.use_shared_qris) return getSetting('qris_payload');
  return store.qris_payload || null;
}

export function getQrisInfo(storeId = null) {
  const store = getStoreRow(storeId);
  const useShared = !store || Boolean(store.use_shared_qris);
  const payload = useShared ? getSetting('qris_payload') : store.qris_payload;
  const meta = { useShared, scope: useShared ? 'shared' : 'store' };
  if (!payload) return { configured: false, ...meta };
  try {
    const info = analyzeQris(payload);
    return {
      configured: true,
      merchantName: info.merchantName,
      merchantCity: info.merchantCity,
      nmid: info.nmid,
      ...meta,
    };
  } catch {
    return { configured: false, ...meta };
  }
}

// ---------- Bank accounts ----------

const listSharedBanksStmt = db.prepare('SELECT * FROM bank_accounts WHERE store_id IS NULL ORDER BY id ASC');
const listStoreBanksStmt = db.prepare('SELECT * FROM bank_accounts WHERE store_id = ? ORDER BY id ASC');

export const serializeBank = (row) => ({
  id: row.id,
  storeId: row.store_id ?? null,
  bankName: row.bank_name,
  accountNumber: row.account_number,
  accountName: row.account_name,
});

export function listBanks(storeId = null) {
  const store = getStoreRow(storeId);
  if (!store || store.use_shared_banks) return listSharedBanksStmt.all().map(serializeBank);
  return listStoreBanksStmt.all(store.id).map(serializeBank);
}

export function isUsingSharedBanks(storeId = null) {
  const store = getStoreRow(storeId);
  return !store || Boolean(store.use_shared_banks);
}

// ---------- Display (customer screen) key ----------

const allDisplayKeysStmt = db.prepare('SELECT id, name, display_key FROM stores');
const updateDisplayKeyStmt = db.prepare('UPDATE stores SET display_key = ? WHERE id = ?');

export const normalizeDisplayKey = (key) => String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function regenerateDisplayKey(storeId = null) {
  const store = getStoreRow(storeId);
  if (!store) return null;
  const key = generateUniqueDisplayKey();
  updateDisplayKeyStmt.run(key, store.id);
  return key;
}

export function getDisplayKey(storeId = null) {
  const store = getStoreRow(storeId);
  if (!store) return null;
  return store.display_key || regenerateDisplayKey(store.id);
}

export const formatDisplayKey = (key) => (key ? `${key.slice(0, 4)}-${key.slice(4)}` : '');

/** Returns the matching store row { id, name } for a customer display key, or null. */
export function findStoreByDisplayKey(candidate) {
  const normalized = normalizeDisplayKey(candidate);
  if (!normalized) return null;
  const a = Buffer.from(normalized);
  for (const row of allDisplayKeysStmt.all()) {
    const b = Buffer.from(String(row.display_key || ''));
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { id: row.id, name: row.name };
    }
  }
  return null;
}

// ---------- Products ----------

export const serializeProduct = (row) => ({
  id: row.id,
  storeId: row.store_id,
  name: row.name,
  price: row.price,
  category: row.category,
  image: row.image ? `/uploads/${row.image}` : null,
  updatedAt: row.updated_at,
});

const getProductLiteStmt = db.prepare('SELECT id, store_id, name, price FROM products WHERE id = ? AND store_id = ?');

export function getProductLite(id, storeId) {
  return getProductLiteStmt.get(id, storeId) ?? null;
}

// ---------- Transactions ----------

const getTxStmt = db.prepare(`
  SELECT t.*, s.name AS store_name
  FROM transactions t
  LEFT JOIN stores s ON s.id = t.store_id
  WHERE t.id = ?
`);

export function serializeTx(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    storeName: row.store_name ?? null,
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
