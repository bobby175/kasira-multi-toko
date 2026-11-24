// Auto-confirm payments from notifications forwarded by the merchant's Android phone
// (e.g. MacroDroid reading the QRIS merchant / bank app notifications).
// Manual confirmation keeps working; this only confirms when the match is unambiguous.
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';
import { getTx } from './data.js';

export const DEFAULT_IGNORE_WORDS = 'keluar, terkirim, dikirim, mengirim, debet, debit, gagal, ditolak, dibatalkan, refund';
// Forwarder apps may fire twice for one notification. Keep the window short: two customers paying
// the same amount can produce identical text (include {not_timestamp} in the forwarded body to be safe).
const DUPLICATE_WINDOW_MS = 60 * 1000;
const KEEP_LOG_ROWS = 500;

// ---------- Settings ----------

export function getAutoConfirmSettings() {
  return {
    enabled: getSetting('autoconfirm_enabled', '0') === '1',
    windowMinutes: Number(getSetting('autoconfirm_window', '30')) || 30,
    ignoreWords: getSetting('autoconfirm_ignore', DEFAULT_IGNORE_WORDS),
  };
}

export function getNotifyToken() {
  let token = getSetting('notify_token');
  if (!token) token = regenerateNotifyToken();
  return token;
}

export function regenerateNotifyToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  setSetting('notify_token', token);
  return token;
}

export function isValidNotifyToken(candidate) {
  const a = Buffer.from(String(candidate ?? ''));
  const b = Buffer.from(getNotifyToken());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
  return ignoreWords
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .find((w) => lower.includes(w)) ?? null;
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
      values = Object.values(data).filter((v) => typeof v === 'string' || typeof v === 'number').map(String);
    } catch {
      values = [raw]; // not valid JSON (e.g. unescaped quotes from magic text): use as plain text
    }
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    source = params.get('app') ?? params.get('source') ?? '';
    values = [...params.values()];
  } else {
    // Plain text: first line is the app name (as in the suggested MacroDroid body), the rest is the content.
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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

const pendingByAmountStmt = (count) =>
  db.prepare(`
    SELECT id FROM transactions
    WHERE status = 'pending' AND created_at >= ? AND total IN (${Array(count).fill('?').join(',')})
    ORDER BY id DESC
  `);
const countPendingStmt = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status = 'pending'");
const insertLogStmt = db.prepare(`
  INSERT INTO payment_notifications (received_at, source, text, amounts, result, tx_id, detail)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const recentSameStmt = db.prepare(`
  SELECT id FROM payment_notifications WHERE text = ? AND source = ? AND received_at >= ? LIMIT 1
`);
const confirmAutoStmt = db.prepare(`
  UPDATE transactions
  SET status = 'paid', confirmed_by = NULL, confirmed_by_name = 'Otomatis', confirmed_at = ?,
      confirm_source = 'auto', confirm_note = ?
  WHERE id = ? AND status = 'pending'
`);

/**
 * Decide what a notification means. With `dryRun` nothing is changed or logged.
 * Result: confirmed | would_confirm | ambiguous | no_match | no_amount | ignored | duplicate
 */
export function evaluateNotification({ source = '', text }, { dryRun = false, now = Date.now() } = {}) {
  const settings = getAutoConfirmSettings();
  const amounts = parseAmounts(text);
  const base = { amounts, enabled: settings.enabled, transaction: null, candidates: [] };

  if (!dryRun && recentSameStmt.get(text, source, now - DUPLICATE_WINDOW_MS)) {
    return { ...base, result: 'duplicate', detail: 'Notifikasi yang sama sudah diterima' };
  }
  const word = ignoredWord(text, settings.ignoreWords);
  if (word) return { ...base, result: 'ignored', detail: `Mengandung kata "${word}"` };
  if (amounts.length === 0) return { ...base, result: 'no_amount', detail: 'Tidak ada nominal "Rp" di teks' };

  const since = now - settings.windowMinutes * 60 * 1000;
  const candidates = pendingByAmountStmt(amounts.length).all(since, ...amounts).map((r) => getTx(r.id));
  if (candidates.length === 0) {
    return { ...base, result: 'no_match', detail: 'Tidak ada pembayaran menunggu dengan nominal ini' };
  }
  if (candidates.length > 1) {
    return {
      ...base,
      candidates,
      result: 'ambiguous',
      detail: `Ada ${candidates.length} pembayaran menunggu dengan nominal yang cocok, konfirmasi manual`,
    };
  }
  const [transaction] = candidates;
  if (dryRun || !settings.enabled) {
    return { ...base, candidates, transaction, result: 'would_confirm', detail: settings.enabled ? null : 'Konfirmasi otomatis nonaktif' };
  }
  const changed = confirmAutoStmt.run(now, text.slice(0, 300), transaction.id).changes;
  if (changed === 0) return { ...base, result: 'no_match', detail: 'Transaksi sudah dikonfirmasi lebih dulu' };
  return { ...base, candidates, transaction: getTx(transaction.id), result: 'confirmed', detail: null };
}

export function logNotification({ source, text }, outcome, now = Date.now()) {
  insertLogStmt.run(
    now, source, text, JSON.stringify(outcome.amounts), outcome.result, outcome.transaction?.id ?? null, outcome.detail ?? null
  );
  db.prepare('DELETE FROM payment_notifications WHERE id <= (SELECT MAX(id) FROM payment_notifications) - ?').run(KEEP_LOG_ROWS);
}

export function hasPendingTransactions() {
  return countPendingStmt.get().n > 0;
}

export function recentNotifications(limit = 20) {
  return db
    .prepare(`
      SELECT n.*, t.code AS tx_code FROM payment_notifications n
      LEFT JOIN transactions t ON t.id = n.tx_id
      ORDER BY n.id DESC LIMIT ?
    `)
    .all(limit)
    .map((r) => ({
      id: r.id,
      receivedAt: r.received_at,
      source: r.source,
      text: r.text,
      amounts: JSON.parse(r.amounts),
      result: r.result,
      txCode: r.tx_code ?? null,
      detail: r.detail,
    }));
}
