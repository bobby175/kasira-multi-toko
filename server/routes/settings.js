import os from 'node:os';
import { Router } from 'express';
import { db, setSetting } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  getStoreSettings, getQrisInfo, listBanks, serializeBank,
  getDisplayKey, regenerateDisplayKey, formatDisplayKey,
} from '../data.js';
import { analyzeQris, toDynamicQris } from '../qris.js';
import {
  DEFAULT_IGNORE_WORDS, evaluateNotification, getAutoConfirmSettings, getNotifyToken,
  recentNotifications, regenerateNotifyToken,
} from '../notify.js';
import { emitToStaff, pushDisplay, disconnectDisplays } from '../realtime.js';
import { httpError, str, parseId } from '../util.js';

function settingsPayload() {
  return {
    store: getStoreSettings(),
    qris: getQrisInfo(),
    banks: listBanks(),
    autoConfirm: { enabled: getAutoConfirmSettings().enabled },
  };
}

function settingsChanged() {
  emitToStaff('settings:changed');
  pushDisplay();
}

// Typical home/shop Wi-Fi ranges first; VPN/CGNAT (e.g. 100.x) and others last.
function addressRank(ip) {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  if (ip.startsWith('169.254.')) return 4;
  return 3;
}

function lanAddresses() {
  const out = [];
  let ifaces = {};
  try {
    ifaces = os.networkInterfaces();
  } catch {
    // Some sandboxed environments (e.g. Termux on Android 13+) block network interface enumeration.
    return out;
  }
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
    }
  }
  return out.sort((a, b) => addressRank(a) - addressRank(b));
}

function readBank(body) {
  return {
    bankName: str(body?.bankName, { field: 'Nama bank', required: true, max: 40 }),
    accountNumber: str(body?.accountNumber, {
      field: 'Nomor rekening', required: true, max: 30,
      pattern: /^[0-9 .-]+$/, patternMessage: 'Nomor rekening hanya boleh berisi angka',
    }),
    accountName: str(body?.accountName, { field: 'Nama pemilik rekening', required: true, max: 60 }),
  };
}

function analyzeOrThrow(payload) {
  try {
    return analyzeQris(payload);
  } catch (err) {
    throw httpError(400, err.message);
  }
}

const router = Router();

router.get('/settings', requireAuth, (_req, res) => {
  res.json(settingsPayload());
});

router.put('/settings/store', requireAdmin, (req, res) => {
  const body = req.body ?? {};
  setSetting('store_name', str(body.name, { field: 'Nama toko', required: true, max: 60 }));
  setSetting('store_address', str(body.address, { field: 'Alamat', max: 160 }));
  setSetting('store_phone', str(body.phone, { field: 'Telepon', max: 30 }));
  setSetting('receipt_footer', str(body.footer, { field: 'Catatan struk', max: 160 }));
  setSetting('paper_width', Number(body.paperWidth) === 80 ? '80' : '58');
  settingsChanged();
  res.json(settingsPayload());
});

// Preview a QRIS before saving it (returns merchant info + a sample dynamic QR).
router.post('/settings/qris/analyze', requireAdmin, (req, res) => {
  const info = analyzeOrThrow(req.body?.payload);
  res.json({
    info: {
      merchantName: info.merchantName,
      merchantCity: info.merchantCity,
      nmid: info.nmid,
      isStatic: info.isStatic,
    },
    sample: { amount: 10000, payload: toDynamicQris(info.payload, 10000) },
  });
});

router.put('/settings/qris', requireAdmin, (req, res) => {
  const info = analyzeOrThrow(req.body?.payload);
  setSetting('qris_payload', info.payload);
  settingsChanged();
  res.json(settingsPayload());
});

router.delete('/settings/qris', requireAdmin, (_req, res) => {
  setSetting('qris_payload', null);
  settingsChanged();
  res.json(settingsPayload());
});

router.post('/settings/banks', requireAdmin, (req, res) => {
  const bank = readBank(req.body);
  db.prepare('INSERT INTO bank_accounts (bank_name, account_number, account_name, created_at) VALUES (?, ?, ?, ?)').run(
    bank.bankName, bank.accountNumber, bank.accountName, Date.now()
  );
  settingsChanged();
  res.status(201).json(settingsPayload());
});

router.put('/settings/banks/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const bank = readBank(req.body);
  const result = db
    .prepare('UPDATE bank_accounts SET bank_name = ?, account_number = ?, account_name = ? WHERE id = ?')
    .run(bank.bankName, bank.accountNumber, bank.accountName, id);
  if (result.changes === 0) throw httpError(404, 'Rekening tidak ditemukan');
  settingsChanged();
  res.json(settingsPayload());
});

router.delete('/settings/banks/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const result = db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(id);
  if (result.changes === 0) throw httpError(404, 'Rekening tidak ditemukan');
  settingsChanged();
  res.json(settingsPayload());
});

// ---------- Auto-confirm from payment notifications ----------

function autoConfirmPayload(req) {
  const port = req.socket.localPort;
  const token = getNotifyToken();
  return {
    ...getAutoConfirmSettings(),
    defaultIgnoreWords: DEFAULT_IGNORE_WORDS,
    webhookPath: `/api/notify/${token}`,
    lanUrls: lanAddresses().map((ip) => `http://${ip}:${port}`),
    recent: recentNotifications(20),
  };
}

router.get('/settings/autoconfirm', requireAdmin, (req, res) => {
  res.json(autoConfirmPayload(req));
});

router.put('/settings/autoconfirm', requireAdmin, (req, res) => {
  const body = req.body ?? {};
  const windowMinutes = Number(body.windowMinutes);
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 240) {
    throw httpError(400, 'Batas waktu harus 1 sampai 240 menit');
  }
  setSetting('autoconfirm_enabled', body.enabled ? '1' : '0');
  setSetting('autoconfirm_window', String(windowMinutes));
  setSetting('autoconfirm_ignore', str(body.ignoreWords, { field: 'Kata yang diabaikan', max: 300 }));
  settingsChanged();
  res.json(autoConfirmPayload(req));
});

router.post('/settings/autoconfirm/regenerate', requireAdmin, (req, res) => {
  regenerateNotifyToken();
  res.json(autoConfirmPayload(req));
});

// Dry run: what would happen with this notification text right now (changes nothing).
router.post('/settings/autoconfirm/test', requireAdmin, (req, res) => {
  const text = str(req.body?.text, { field: 'Teks notifikasi', required: true, max: 1000 });
  const outcome = evaluateNotification({ source: 'Uji coba', text }, { dryRun: true });
  res.json({
    result: outcome.result,
    detail: outcome.detail,
    amounts: outcome.amounts,
    transaction: outcome.transaction ? { code: outcome.transaction.code, total: outcome.transaction.total } : null,
    candidates: outcome.candidates.map((t) => t.code),
  });
});

// ---------- Customer display pairing ----------

router.get('/display', requireAuth, (req, res) => {
  const port = req.socket.localPort;
  res.json({
    key: formatDisplayKey(getDisplayKey()),
    lanUrls: lanAddresses().map((ip) => `http://${ip}:${port}`),
  });
});

router.post('/display/regenerate', requireAdmin, (_req, res) => {
  const key = regenerateDisplayKey();
  disconnectDisplays();
  res.json({ key: formatDisplayKey(key) });
});

export { lanAddresses };
export default router;
