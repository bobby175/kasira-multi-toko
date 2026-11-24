import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { DATA_DIR, ROOT, UPLOAD_DIR } from './db.js';
import { getStoreSettings } from './data.js';
import { attachUser, csrfGuard } from './auth.js';
import { initRealtime } from './realtime.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import transactionRoutes from './routes/transactions.js';
import settingsRoutes, { lanAddresses } from './routes/settings.js';
import userRoutes from './routes/users.js';
import notifyRoutes from './routes/notify.js';

const isDev = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DIST = path.join(ROOT, 'dist');

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

// ---------- API ----------
const api = express.Router();
api.use(express.json({ limit: '3mb' }));
api.use(csrfGuard);
api.use(attachUser);
api.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
api.use(authRoutes);
api.use(settingsRoutes);
api.use('/products', productRoutes);
api.use('/transactions', transactionRoutes);
api.use('/users', userRoutes);
api.use((_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));
app.use('/api/notify', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, notifyRoutes);
app.use('/api', api);

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, fallthrough: false }));

// ---------- Frontend ----------
if (isDev) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ root: ROOT, appType: 'spa', server: { middlewareMode: true } });
  app.use(vite.middlewares);
} else if (fs.existsSync(path.join(DIST, 'index.html'))) {
  app.use('/assets', express.static(path.join(DIST, 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.use((_req, res) => {
    res.status(503).type('text/plain').send('Frontend belum di-build. Jalankan "npm run build" lalu "npm start".');
  });
}

// ---------- Errors ----------
app.use((err, req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message;
  if (err.type === 'entity.too.large') message = 'Ukuran data terlalu besar';
  else if (err.type === 'entity.parse.failed') message = 'Format data tidak valid';
  else if (status === 404) message = 'Tidak ditemukan';
  if (status >= 500) {
    console.error(err);
    message = 'Terjadi kesalahan pada server';
  }
  if (!req.originalUrl.startsWith('/api') && status === 404) return res.status(404).type('text/plain').send(message);
  res.status(status).json({ error: message });
});

initRealtime(server);

server.listen(PORT, HOST, () => {
  const line = '-'.repeat(52);
  console.log(`\n${line}\n  Kasira berjalan${isDev ? ' (mode development)' : ''}\n${line}`);
  console.log(`  Komputer ini   : http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  HP / Tablet    : http://${ip}:${PORT}`);
  console.log(`${line}`);
  console.log(`  Toko           : ${getStoreSettings().name}`);
  console.log(`  Folder data    : ${DATA_DIR}`);
  if (path.resolve(DATA_DIR) !== path.join(ROOT, 'data')) {
    console.log('  PERINGATAN     : ini BUKAN folder data utama (variabel DATA_DIR terisi).');
    console.log('                   Tutup terminal ini dan jalankan "npm start" di terminal baru.');
  }
  console.log(`${line}\n  Pastikan semua perangkat terhubung ke Wi-Fi yang sama.\n`);
});
