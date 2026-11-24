import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'kasira.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('admin', 'karyawan')),
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
    name       TEXT    NOT NULL,
    price      INTEGER NOT NULL CHECK (price >= 0),
    category   TEXT    NOT NULL DEFAULT '',
    image      TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bank_accounts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
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
  CREATE TABLE IF NOT EXISTS payment_notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
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
addColumnIfMissing('transactions', 'confirm_source', "TEXT"); // 'manual' | 'auto'
addColumnIfMissing('transactions', 'confirm_note', 'TEXT'); // notification text that confirmed it

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
