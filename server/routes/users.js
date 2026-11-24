import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin, hashPassword, deleteUserSessions } from '../auth.js';
import { disconnectUser } from '../realtime.js';
import { httpError, str, parseId } from '../util.js';
import { USERNAME_RULE, validatePassword } from './auth.js';

const ROLES = ['admin', 'karyawan'];

const serializeUser = (row) => ({
  id: row.id,
  name: row.name,
  username: row.username,
  role: row.role,
  active: Boolean(row.active),
  createdAt: row.created_at,
});

const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
const findByUsername = db.prepare('SELECT id FROM users WHERE username = ?');
const countOtherActiveAdmins = db.prepare(
  "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?"
);

function readRole(value) {
  if (!ROLES.includes(value)) throw httpError(400, 'Peran tidak valid');
  return value;
}

const router = Router();
router.use(requireAdmin);

router.get('/', (_req, res) => {
  res.json({ users: db.prepare('SELECT * FROM users ORDER BY role, name COLLATE NOCASE').all().map(serializeUser) });
});

router.post('/', (req, res) => {
  const name = str(req.body?.name, { field: 'Nama', required: true, max: 60 });
  const username = str(req.body?.username, { field: 'Username', required: true, ...USERNAME_RULE });
  const password = validatePassword(req.body?.password);
  const role = readRole(req.body?.role ?? 'karyawan');
  if (findByUsername.get(username)) throw httpError(409, 'Username sudah dipakai');
  const info = db
    .prepare('INSERT INTO users (name, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, username, hashPassword(password), role, Date.now());
  res.status(201).json({ user: serializeUser(getUser.get(Number(info.lastInsertRowid))) });
});

router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const existing = getUser.get(id);
  if (!existing) throw httpError(404, 'Pengguna tidak ditemukan');
  const isSelf = id === req.user.id;

  const name = str(req.body?.name, { field: 'Nama', required: true, max: 60 });
  const username = str(req.body?.username, { field: 'Username', required: true, ...USERNAME_RULE });
  const role = readRole(req.body?.role ?? existing.role);
  const active = req.body?.active === undefined ? Boolean(existing.active) : Boolean(req.body.active);
  const password = req.body?.password ? validatePassword(req.body.password) : null;

  const other = findByUsername.get(username);
  if (other && other.id !== id) throw httpError(409, 'Username sudah dipakai');
  if (isSelf && (role !== existing.role || !active)) {
    throw httpError(400, 'Anda tidak dapat mengubah peran atau menonaktifkan akun sendiri');
  }
  const losesAdmin = existing.role === 'admin' && existing.active && (role !== 'admin' || !active);
  if (losesAdmin && countOtherActiveAdmins.get(id).n === 0) {
    throw httpError(400, 'Minimal harus ada satu admin aktif');
  }

  db.prepare('UPDATE users SET name = ?, username = ?, role = ?, active = ? WHERE id = ?').run(
    name, username, role, active ? 1 : 0, id
  );
  if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);

  // Force re-login when access changes; keep the admin's own current session.
  if (role !== existing.role || !active || password) {
    deleteUserSessions(id, isSelf ? req.sessionTokenHash : null);
    if (!isSelf) disconnectUser(id);
  }
  res.json({ user: serializeUser(getUser.get(id)) });
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const existing = getUser.get(id);
  if (!existing) throw httpError(404, 'Pengguna tidak ditemukan');
  if (id === req.user.id) throw httpError(400, 'Anda tidak dapat menghapus akun sendiri');
  if (existing.role === 'admin' && existing.active && countOtherActiveAdmins.get(id).n === 0) {
    throw httpError(400, 'Minimal harus ada satu admin aktif');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  disconnectUser(id);
  res.json({ ok: true });
});

export default router;
