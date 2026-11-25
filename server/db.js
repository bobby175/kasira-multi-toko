import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

export const DEFAULT_STORE_FOOTER = 'Terima kasih atas kunjungan Anda!';
export const DEFAULT_IGNORE_WORDS =
  'keluar, terkirim, dikirim, mengirim, debet, debit, gagal, ditolak, dibatalkan, refund';

const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomDisplayKey() {
  let key = '';
  for (let i = 0; i < 8; i++) key += KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)];
  return key;
}

export function randomNotifyToken() {
  return crypto.randomBytes(24).toString('base64url');
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'kasira.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS stores (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    name                   TEXT    NOT NULL,
    address                TEXT    NOT NULL DEFAULT '',
    phone                  TEXT    NOT NULL DEFAULT '',
    receipt_footer         TEXT    NOT NULL DEFAULT 'Terima kasih atas kunjungan Anda!',
    paper_width            INTEGER NOT NULL DEFAULT 58,
    display_key            TEXT    NOT NULL UNIQUE,
    use_shared_qris        INTEGER NOT NULL DEFAULT 1,
    qris_payload           TEXT,
    use_shared_banks       INTEGER NOT NULL DEFAULT 1,
    use_shared_autoconfirm INTEGER NOT NULL DEFAULT 1,
    autoconfirm_enabled    INTEGER NOT NULL DEFAULT 0,
    autoconfirm_window     INTEGER NOT NULL DEFAULT 30,
    autoconfirm_ignore     TEXT    NOT NULL DEFAULT 'keluar, terkirim, dikirim, mengirim, debet, debit, gagal, ditolak, dibatalkan, refund',
    notify_token           TEXT    NOT NULL UNIQUE,
    created_at             INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('admin', 'karyawan')),
    store_id      INTEGER REFERENCES stores(id) ON DELETE SET NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id   INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    price      INTEGER NOT NULL CHECK (price >= 0),
    category   TEXT    NOT NULL DEFAULT '',
    image      TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bank_accounts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id       INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    bank_name      TEXT    NOT NULL,
    account_number TEXT    NOT NULL,
    account_name   TEXT    NOT NULL,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id          INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    code              TEXT    NOT NULL UNIQUE,
    items             TEXT    NOT NULL,
    item_count        INTEGER NOT NULL,
    total             INTEGER NOT NULL,
    method            TEXT    NOT NULL CHECK (method IN ('qris', 'transfer')),
    status            TEXT    NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled')),
    qris_payload      TEXT,
    created_by        INTEGER,
    created_by_name   TEXT    NOT NULL,
    confirmed_by      INTEGER,
    confirmed_by_name TEXT,
    cancelled_by      INTEGER,
    cancelled_by_name TEXT,
    created_at        INTEGER NOT NULL,
    confirmed_at      INTEGER,
    cancelled_at      INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_tx_status  ON transactions(status);
  CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  -- Payment notifications forwarded from the merchant's Android phone (auto-confirm).
  -- store_id NULL = received via the shared (Pusat) webhook; non-null = store-specific webhook.
  CREATE TABLE IF NOT EXISTS payment_notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id    INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    received_at INTEGER NOT NULL,
    source      TEXT    NOT NULL DEFAULT '',
    text        TEXT    NOT NULL DEFAULT '',
    amounts     TEXT    NOT NULL DEFAULT '[]',
    result      TEXT    NOT NULL,
    tx_id       INTEGER,
    detail      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_notif_received ON payment_notifications(received_at);
`);

// ---------- Migrations for databases created by earlier versions ----------
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('transactions', 'confirm_source', 'TEXT'); // 'manual' | 'auto'
addColumnIfMissing('transactions', 'confirm_note', 'TEXT'); // notification text that confirmed it
addColumnIfMissing('users', 'store_id', 'INTEGER REFERENCES stores(id) ON DELETE SET NULL');
addColumnIfMissing('products', 'store_id', 'INTEGER REFERENCES stores(id) ON DELETE CASCADE');
addColumnIfMissing('bank_accounts', 'store_id', 'INTEGER REFERENCES stores(id) ON DELETE CASCADE');
addColumnIfMissing('transactions', 'store_id', 'INTEGER REFERENCES stores(id) ON DELETE CASCADE');
addColumnIfMissing('payment_notifications', 'store_id', 'INTEGER REFERENCES stores(id) ON DELETE CASCADE');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
  CREATE INDEX IF NOT EXISTS idx_banks_store ON bank_accounts(store_id);
  CREATE INDEX IF NOT EXISTS idx_tx_store_status ON transactions(store_id, status);
  CREATE INDEX IF NOT EXISTS idx_tx_store_created ON transactions(store_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_notif_store_received ON payment_notifications(store_id, received_at);
`);

/** Run fn inside a SQLite transaction. */
export function inTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
const deleteSettingStmt = db.prepare('DELETE FROM settings WHERE key = ?');

export function getSetting(key, fallback = null) {
  const row = getSettingStmt.get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  if (value === null || value === undefined) deleteSettingStmt.run(key);
  else setSettingStmt.run(key, String(value));
}

// ---------- Migrate existing single-store data into Store #1 ----------
function migrateSingleStoreToMultiStore() {
  const storeCount = db.prepare('SELECT COUNT(*) AS n FROM stores').get().n;
  const hasExistingData =
    db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0 ||
    db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0 ||
    db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n > 0 ||
    Boolean(getSetting('store_name')) ||
    Boolean(getSetting('display_key'));

  if (storeCount === 0 && hasExistingData) {
    inTransaction(() => {
      if (db.prepare('SELECT COUNT(*) AS n FROM stores').get().n > 0) return;
      const name = getSetting('store_name', 'Toko Saya') || 'Toko Saya';
      const address = getSetting('store_address', '') || '';
      const phone = getSetting('store_phone', '') || '';
      const footer = getSetting('receipt_footer', DEFAULT_STORE_FOOTER) || DEFAULT_STORE_FOOTER;
      const paperWidth = Number(getSetting('paper_width', '58')) === 80 ? 80 : 58;
      const displayKey = getSetting('display_key') || randomDisplayKey();
      const info = db
        .prepare(`
          INSERT INTO stores (
            name, address, phone, receipt_footer, paper_width, display_key,
            use_shared_qris, use_shared_banks, use_shared_autoconfirm,
            autoconfirm_enabled, autoconfirm_window, autoconfirm_ignore, notify_token, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, 0, 30, ?, ?, ?)
        `)
        .run(
          name, address, phone, footer, paperWidth, displayKey,
          DEFAULT_IGNORE_WORDS, randomNotifyToken(), Date.now()
        );
      const firstStoreId = Number(info.lastInsertRowid);
      db.prepare('UPDATE products SET store_id = ? WHERE store_id IS NULL').run(firstStoreId);
      db.prepare('UPDATE transactions SET store_id = ? WHERE store_id IS NULL').run(firstStoreId);
      db.prepare("UPDATE users SET store_id = ? WHERE role = 'karyawan' AND store_id IS NULL").run(firstStoreId);
      // Existing bank_accounts, settings.qris_payload, settings.autoconfirm_*, and settings.notify_token
      // naturally become the shared (Pusat / Tetap) configuration used by Store #1.
    });
  } else if (storeCount > 0) {
    const first = db.prepare('SELECT id FROM stores ORDER BY id ASC LIMIT 1').get();
    if (first) {
      db.prepare('UPDATE products SET store_id = ? WHERE store_id IS NULL').run(first.id);
      db.prepare('UPDATE transactions SET store_id = ? WHERE store_id IS NULL').run(first.id);
      db.prepare("UPDATE users SET store_id = ? WHERE role = 'karyawan' AND store_id IS NULL").run(first.id);
    }
  }
}

migrateSingleStoreToMultiStore();
