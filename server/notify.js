// Auto-confirm payments from notifications forwarded by the merchant's Android phone
// (e.g. MacroDroid reading the QRIS merchant / bank app notifications).
// Supports both shared (Pusat / Tetap) webhook across branches and per-store dedicated webhooks.
// Manual confirmation keeps working; this only confirms when the match is unambiguous.
import crypto from 'node:crypto';
import { db, getSetting, setSetting, DEFAULT_IGNORE_WORDS } from './db.js';
import { generateUniqueNotifyToken, getStoreRow, getTx } from './data.js';

export { DEFAULT_IGNORE_WORDS };

// Forwarder apps may fire twice for one notification. Keep the window short: two customers paying
// the same amount can produce identical text (include {not_timestamp} in the forwarded body to be safe).
const DUPLICATE_WINDOW_MS = 60 * 1000;
const KEEP_LOG_ROWS = 500;

// ---------- Settings & Tokens ----------

export function getSharedAutoConfirmSettings() {
  return {
    enabled: getSetting('autoconfirm_enabled', '0') === '1',
    windowMinutes: Number(getSetting('autoconfirm_window', '30')) || 30,
    ignoreWords: getSetting('autoconfirm_ignore', DEFAULT_IGNORE_WORDS),
  };
}

export function getSharedNotifyToken() {
  let token = getSetting('notify_token');
  if (!token) token = regenerateSharedNotifyToken();
  return token;
}

export function regenerateSharedNotifyToken() {
  const token = generateUniqueNotifyToken();
  setSetting('notify_token', token);
  return token;
}

export function getAutoConfirmSettings(storeId = null) {
  const store = getStoreRow(storeId);
  if (!store || store.use_shared_autoconfirm) {
    return {
      ...getSharedAutoConfirmSettings(),
      useShared: true,
      scope: 'shared',
    };
  }
  return {
    enabled: Boolean(store.autoconfirm_enabled),
    windowMinutes: Number(store.autoconfirm_window) || 30,
    ignoreWords: store.autoconfirm_ignore ?? DEFAULT_IGNORE_WORDS,
    useShared: false,
    scope: 'store',
  };
}

export function getNotifyToken(storeId = null) {
  const store = getStoreRow(storeId);
  if (!store || store.use_shared_autoconfirm) return getSharedNotifyToken();
  if (store.notify_token) return store.notify_token;
  return regenerateNotifyToken(store.id);
}

export function regenerateNotifyToken(storeId = null) {
  const store = getStoreRow(storeId);
  if (!store || store.use_shared_autoconfirm) return regenerateSharedNotifyToken();
  const token = generateUniqueNotifyToken();
  db.prepare('UPDATE stores SET notify_token = ? WHERE id = ?').run(token, store.id);
  return token;
}

const allStoreTokensStmt = db.prepare('SELECT id, name, notify_token FROM stores');
const sharedStoresStmt = db.prepare('SELECT id, name FROM stores WHERE use_shared_autoconfirm = 1 ORDER BY id ASC');

export function listSharedAutoConfirmStores() {
  return sharedStoresStmt.all();
}

function timingSafeEquals(aStr, bStr) {
  const a = Buffer.from(String(aStr ?? ''));
  const b = Buffer.from(String(bStr ?? ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Resolve a webhook URL token to either the shared (Pusat) scope or a specific store. */
export function resolveNotifyTarget(candidate) {
  if (!candidate) return null;
  if (timingSafeEquals(candidate, getSharedNotifyToken())) {
    return { scope: 'shared', storeId: null, storeName: null };
  }
  for (const row of allStoreTokensStmt.all()) {
    if (timingSafeEquals(candidate, row.notify_token)) {
      return { scope: 'store', storeId: row.id, storeName: row.name };
    }
  }
  return null;
}

// ---------- Parsing ----------

const AMOUNT_RE = /(?:\bRp\.?|\bIDR)\s*([0-9][0-9.,]*)/gi;

function normalizeAmount(raw) {
  const s = raw.replace(/[.,]+$/, ''); // drop sentence punctuation, e.g. "Rp18.000." or "Rp18.000,-"
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) return Number(s.replace(/,\d{1,2}$/, '').replace(/\./g, '')); // 18.000,00
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return Number(s.replace(/\.\d{1,2}$/, '').replace(/,/g, '')); // 18,000.00
  if (/^\d+([.,]\d{1,2})?$/.test(s)) return Math.floor(Number(s.replace(',', '.'))); // 18000 / 18000,00
  return null;
}

/** All rupiah amounts written as "Rp ..." / "IDR ..." in the text. */
export function parseAmounts(text) {
  const found = new Set();
  for (const match of String(text).matchAll(AMOUNT_RE)) {
    const amount = normalizeAmount(match[1]);
    if (Number.isSafeInteger(amount) && amount > 0 && amount < 1e12) found.add(amount);
  }
  return [...found];
}

function ignoredWord(text, ignoreWords) {
  const lower = text.toLowerCase();
  return (
    ignoreWords
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
      .find((w) => lower.includes(w)) ?? null
  );
}

/** Collapse a forwarded payload (JSON, form or plain text) into { source, text }. */
export function extractNotification(rawBody, contentType = '') {
  const raw = typeof rawBody === 'string' ? rawBody : '';
  let values = [];
  let source = '';
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      source = String(data.app ?? data.source ?? data.package ?? '');
      values = Object.values(data)
        .filter((v) => typeof v === 'string' || typeof v === 'number')
        .map(String);
    } catch {
      values = [raw]; // not valid JSON (e.g. unescaped quotes from magic text): use as plain text
    }
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    source = params.get('app') ?? params.get('source') ?? '';
    values = [...params.values()];
  } else {
    // Plain text: first line is the app name (as in the suggested MacroDroid body), the rest is the content.
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      source = lines[0];
      values = lines.slice(1);
    } else {
      values = lines;
    }
  }
  const text = values.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
  return { source: source.replace(/\s+/g, ' ').trim().slice(0, 80), text };
}

// ---------- Matching ----------

const pendingByAmountAndStoresStmt = (storeCount, amountCount) =>
  db.prepare(`
    SELECT id FROM transactions
    WHERE status = 'pending'
      AND created_at >= ?
      AND store_id IN (${Array(storeCount).fill('?').join(',')})
      AND total IN (${Array(amountCount).fill('?').join(',')})
    ORDER BY id DESC
  `);

const insertLogStmt = db.prepare(`
  INSERT INTO payment_notifications (store_id, received_at, source, text, amounts, result, tx_id, detail)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const recentSameSharedStmt = db.prepare(`
  SELECT id FROM payment_notifications
  WHERE store_id IS NULL AND text = ? AND source = ? AND received_at >= ?
  LIMIT 1
`);
const recentSameStoreStmt = db.prepare(`
  SELECT id FROM payment_notifications
  WHERE store_id = ? AND text = ? AND source = ? AND received_at >= ?
  LIMIT 1
`);
const confirmAutoStmt = db.prepare(`
  UPDATE transactions
  SET status = 'paid', confirmed_by = NULL, confirmed_by_name = 'Otomatis', confirmed_at = ?,
      confirm_source = 'auto', confirm_note = ?
  WHERE id = ? AND status = 'pending'
`);

export function targetStoreIdsForScope({ scope = 'shared', storeId = null } = {}) {
  if (scope === 'store') return storeId ? [storeId] : [];
  return listSharedAutoConfirmStores().map((s) => s.id);
}

/**
 * Decide what a notification means. With `dryRun` nothing is changed or logged.
 * Result: confirmed | would_confirm | ambiguous | no_match | no_amount | ignored | duplicate
 */
export function evaluateNotification(
  { source = '', text },
  { scope = 'shared', storeId = null, dryRun = false, now = Date.now() } = {}
) {
  const settings = scope === 'store' ? getAutoConfirmSettings(storeId) : getSharedAutoConfirmSettings();
  const targetStoreIds = targetStoreIdsForScope({ scope, storeId });
  const amounts = parseAmounts(text);
  const base = { amounts, enabled: settings.enabled, transaction: null, candidates: [], targetStoreIds };

  if (!dryRun) {
    const dup =
      scope === 'store'
        ? recentSameStoreStmt.get(storeId, text, source, now - DUPLICATE_WINDOW_MS)
        : recentSameSharedStmt.get(text, source, now - DUPLICATE_WINDOW_MS);
    if (dup) return { ...base, result: 'duplicate', detail: 'Notifikasi yang sama sudah diterima' };
  }

  const word = ignoredWord(text, settings.ignoreWords);
  if (word) return { ...base, result: 'ignored', detail: `Mengandung kata "${word}"` };
  if (amounts.length === 0) return { ...base, result: 'no_amount', detail: 'Tidak ada nominal "Rp" di teks' };
  if (targetStoreIds.length === 0) {
    return { ...base, result: 'no_match', detail: 'Tidak ada toko yang memakai pengaturan konfirmasi otomatis ini' };
  }

  const since = now - settings.windowMinutes * 60 * 1000;
  const candidates = pendingByAmountAndStoresStmt(targetStoreIds.length, amounts.length)
    .all(since, ...targetStoreIds, ...amounts)
    .map((r) => getTx(r.id));

  if (candidates.length === 0) {
    return { ...base, result: 'no_match', detail: 'Tidak ada pembayaran menunggu dengan nominal ini' };
  }
  if (candidates.length > 1) {
    const storeNames = [...new Set(candidates.map((t) => t.storeName).filter(Boolean))];
    const scopeHint = scope === 'shared' && storeNames.length > 1 ? ` di ${storeNames.join(', ')}` : '';
    return {
      ...base,
      candidates,
      result: 'ambiguous',
      detail: `Ada ${candidates.length} pembayaran menunggu dengan nominal yang cocok${scopeHint}, konfirmasi manual`,
    };
  }

  const [transaction] = candidates;
  if (dryRun || !settings.enabled) {
    return {
      ...base,
      candidates,
      transaction,
      result: 'would_confirm',
      detail: settings.enabled ? null : 'Konfirmasi otomatis nonaktif',
    };
  }
  const changed = confirmAutoStmt.run(now, text.slice(0, 300), transaction.id).changes;
  if (changed === 0) return { ...base, result: 'no_match', detail: 'Transaksi sudah dikonfirmasi lebih dulu' };
  return { ...base, candidates, transaction: getTx(transaction.id), result: 'confirmed', detail: null };
}

export function logNotification({ source, text }, outcome, { storeId = null, now = Date.now() } = {}) {
  insertLogStmt.run(
    storeId,
    now,
    source,
    text,
    JSON.stringify(outcome.amounts),
    outcome.result,
    outcome.transaction?.id ?? null,
    outcome.detail ?? null
  );
  db.prepare('DELETE FROM payment_notifications WHERE id <= (SELECT MAX(id) FROM payment_notifications) - ?').run(KEEP_LOG_ROWS);
}

export function pendingStoreIdsIn(storeIds) {
  if (!storeIds.length) return [];
  return db
    .prepare(
      `SELECT DISTINCT store_id FROM transactions WHERE status = 'pending' AND store_id IN (${Array(storeIds.length).fill('?').join(',')})`
    )
    .all(...storeIds)
    .map((r) => r.store_id);
}

export function recentNotifications(limit = 20, { scope = 'shared', storeId = null } = {}) {
  const sql =
    scope === 'store'
      ? `
        SELECT n.*, t.code AS tx_code, s.name AS tx_store_name
        FROM payment_notifications n
        LEFT JOIN transactions t ON t.id = n.tx_id
        LEFT JOIN stores s ON s.id = t.store_id
        WHERE n.store_id = ?
        ORDER BY n.id DESC LIMIT ?
      `
      : `
        SELECT n.*, t.code AS tx_code, s.name AS tx_store_name
        FROM payment_notifications n
        LEFT JOIN transactions t ON t.id = n.tx_id
        LEFT JOIN stores s ON s.id = t.store_id
        WHERE n.store_id IS NULL
        ORDER BY n.id DESC LIMIT ?
      `;
  const rows = scope === 'store' ? db.prepare(sql).all(storeId, limit) : db.prepare(sql).all(limit);
  return rows.map((r) => ({
    id: r.id,
    receivedAt: r.received_at,
    source: r.source,
    text: r.text,
    amounts: JSON.parse(r.amounts),
    result: r.result,
    txCode: r.tx_code ?? null,
    txStoreName: r.tx_store_name ?? null,
    detail: r.detail,
  }));
}
