import { Router } from 'express';
import { db, inTransaction, setSetting } from '../db.js';
import {
  hashPassword, verifyPassword, createSession, deleteSession, setSessionCookie,
  clearSessionCookie, rateLimit, resetRateLimit, requireAuth,
} from '../auth.js';
import { disconnectSession } from '../realtime.js';
import { getStoreSettings } from '../data.js';
import { httpError, str } from '../util.js';

export const USERNAME_RULE = {
  pattern: /^[a-zA-Z0-9._-]{3,32}$/,
  patternMessage: 'Username 3-32 karakter: huruf, angka, titik, strip, atau garis bawah',
};

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6) throw httpError(400, 'Kata sandi minimal 6 karakter');
  if (password.length > 100) throw httpError(400, 'Kata sandi maksimal 100 karakter');
  return password;
}

const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users');
const findUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');

const router = Router();

router.get('/bootstrap', (req, res) => {
  res.json({
    needsSetup: countUsers.get().n === 0,
    user: req.user,
    storeName: getStoreSettings().name,
  });
});

router.post('/setup', (req, res) => {
  if (!rateLimit(`setup:${req.ip}`, 10, 15 * 60 * 1000)) throw httpError(429, 'Terlalu banyak percobaan.');
  if (countUsers.get().n > 0) throw httpError(409, 'Setup awal sudah pernah dilakukan.');
  const storeName = str(req.body?.storeName, { field: 'Nama toko', required: true, max: 60 });
  const name = str(req.body?.name, { field: 'Nama Anda', required: true, max: 60 });
  const username = str(req.body?.username, { field: 'Username', required: true, ...USERNAME_RULE });
  const password = validatePassword(req.body?.password);

  const userId = inTransaction(() => {
    if (countUsers.get().n > 0) throw httpError(409, 'Setup awal sudah pernah dilakukan.');
    setSetting('store_name', storeName);
    const info = db
      .prepare('INSERT INTO users (name, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, username, hashPassword(password), 'admin', Date.now());
    return Number(info.lastInsertRowid);
  });

  setSessionCookie(req, res, createSession(userId));
  res.status(201).json({ user: { id: userId, name, username, role: 'admin' } });
});

router.post('/auth/login', (req, res) => {
  const limitKey = `login:${req.ip}`;
  if (!rateLimit(limitKey, 10, 15 * 60 * 1000)) {
    throw httpError(429, 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.');
  }
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = username ? findUserByUsername.get(username) : undefined;
  const ok = verifyPassword(password, user?.password_hash);
  if (!user || !ok) throw httpError(401, 'Username atau kata sandi salah.');
  if (!user.active) throw httpError(403, 'Akun ini dinonaktifkan. Hubungi admin.');

  resetRateLimit(limitKey);
  setSessionCookie(req, res, createSession(user.id));
  res.json({ user: { id: user.id, name: user.name, username: user.username, role: user.role } });
});

router.post('/auth/logout', (req, res) => {
  if (req.sessionTokenHash) {
    deleteSession(req.sessionTokenHash);
    disconnectSession(req.sessionTokenHash);
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
