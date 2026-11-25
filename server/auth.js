import crypto from 'node:crypto';
import { db } from './db.js';
import { getStoreRow, getStoreRowStrict } from './data.js';
import { httpError } from './util.js';

export const SESSION_COOKIE = 'kasira_sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // sliding 30 days
const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- Passwords (scrypt) ----------

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored || DUMMY_HASH).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// ---------- Sessions ----------

const insertSession = db.prepare(
  'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
);
const findSession = db.prepare(`
  SELECT s.token_hash, s.expires_at, u.id, u.name, u.username, u.role, u.store_id, u.active
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ?
`);
const touchSession = db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?');
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const purgeExpired = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  insertSession.run(sha256(token), userId, now, now + SESSION_TTL_MS);
  return token;
}

export function deleteSession(tokenHash) {
  deleteSessionStmt.run(tokenHash);
}

export function deleteUserSessions(userId, exceptTokenHash = null) {
  if (exceptTokenHash) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, exceptTokenHash);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

/** Resolve the logged-in user from a Cookie header. Returns { tokenHash, user } or null. */
export function sessionFromCookieHeader(cookieHeader) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token || token.length > 128) return null;
  const tokenHash = sha256(token);
  const row = findSession.get(tokenHash);
  const now = Date.now();
  if (!row || row.expires_at < now || !row.active) return null;
  if (row.expires_at - now < SESSION_TTL_MS - 24 * 60 * 60 * 1000) {
    touchSession.run(now + SESSION_TTL_MS, tokenHash);
  }
  return {
    tokenHash,
    user: {
      id: row.id,
      name: row.name,
      username: row.username,
      role: row.role,
      storeId: row.store_id ?? null,
    },
  };
}

/** Resolve the active store for a user. Karyawan is strictly locked to their assigned store. */
export function resolveActiveStore(user, requestedStoreId = null) {
  if (!user) return null;
  if (user.role === 'karyawan') return getStoreRowStrict(user.storeId);
  const id = Number(requestedStoreId);
  if (Number.isSafeInteger(id) && id > 0) {
    const chosen = getStoreRowStrict(id);
    if (chosen) return chosen;
  }
  return getStoreRow(null);
}

export function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
}

// ---------- Middleware ----------

export function attachUser(req, _res, next) {
  const session = sessionFromCookieHeader(req.headers.cookie);
  req.user = session?.user ?? null;
  req.sessionTokenHash = session?.tokenHash ?? null;
  const store = resolveActiveStore(req.user, req.get('x-store-id'));
  req.store = store;
  req.storeId = store?.id ?? null;
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(httpError(401, 'Sesi berakhir. Silakan masuk kembali.'));
  if (!req.storeId) return next(httpError(403, 'Toko yang ditugaskan tidak ditemukan. Hubungi admin.'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(httpError(401, 'Sesi berakhir. Silakan masuk kembali.'));
  if (req.user.role !== 'admin') return next(httpError(403, 'Hanya admin yang dapat melakukan tindakan ini.'));
  if (!req.storeId) return next(httpError(403, 'Belum ada toko yang terdaftar.'));
  next();
}

/**
 * CSRF guard: state-changing API calls must carry a custom header.
 * Browsers cannot send custom headers cross-origin without a CORS preflight, which we never allow.
 */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-kasira') !== '1') return next(httpError(403, 'Permintaan ditolak.'));
  next();
}

// ---------- Rate limiting (in-memory) ----------

const buckets = new Map();

/** Returns true when the action is allowed. */
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { count: 0, start: now, windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

export function resetRateLimit(key) {
  buckets.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (now - bucket.start > bucket.windowMs) buckets.delete(key);
  purgeExpired.run(now);
}, 10 * 60 * 1000).unref();
