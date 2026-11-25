import os from 'node:os';
import { Router } from 'express';
import { db, setSetting } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  getStoreRow, getStoreSettings, getQrisInfo, listBanks, isUsingSharedBanks,
  getDisplayKey, regenerateDisplayKey, formatDisplayKey,
} from '../data.js';
import { analyzeQris, toDynamicQris } from '../qris.js';
import {
  DEFAULT_IGNORE_WORDS, evaluateNotification, getAutoConfirmSettings, getNotifyToken,
  listSharedAutoConfirmStores, recentNotifications, regenerateNotifyToken,
} from '../notify.js';
import { emitSettingsChanged, emitStoresChanged, disconnectDisplays } from '../realtime.js';
import { httpError, str, parseId } from '../util.js';

function settingsPayload(storeId) {
  const ac = getAutoConfirmSettings(storeId);
  const useSharedBanks = isUsingSharedBanks(storeId);
  return {
    store: getStoreSettings(storeId),
    qris: getQrisInfo(storeId),
    banks: listBanks(storeId),
    banksMode: { useShared: useSharedBanks, scope: useSharedBanks ? 'shared' : 'store' },
    autoConfirm: { enabled: ac.enabled, useShared: ac.useShared, scope: ac.scope },
  };
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

const MODE_COLUMN = {
  qris: 'use_shared_qris',
  banks: 'use_shared_banks',
  autoconfirm: 'use_shared_autoconfirm',
};

const router = Router();

router.get('/settings', requireAuth, (req, res) => {
  res.json(settingsPayload(req.storeId));
});

router.put('/settings/store', requireAdmin, (req, res) => {
  const body = req.body ?? {};
  const name = str(body.name, { field: 'Nama toko', required: true, max: 60 });
  const address = str(body.address, { field: 'Alamat', max: 160 });
  const phone = str(body.phone, { field: 'Telepon', max: 30 });
  const footer = str(body.footer, { field: 'Catatan struk', max: 160 });
  const paperWidth = Number(body.paperWidth) === 80 ? 80 : 58;
  db.prepare(`
    UPDATE stores SET name = ?, address = ?, phone = ?, receipt_footer = ?, paper_width = ?
    WHERE id = ?
  `).run(name, address, phone, footer, paperWidth, req.storeId);
  emitSettingsChanged(req.storeId);
  emitStoresChanged();
  res.json(settingsPayload(req.storeId));
});

/** Toggle whether QRIS, bank accounts, or auto-confirm follow shared (Pusat / Tetap) or per-store settings. */
router.put('/settings/payment-mode', requireAdmin, (req, res) => {
  const col = MODE_COLUMN[req.body?.feature];
  if (!col) throw httpError(400, 'Fitur pengaturan tidak valid');
  const useShared = req.body?.useShared ? 1 : 0;
  db.prepare(`UPDATE stores SET ${col} = ? WHERE id = ?`).run(useShared, req.storeId);
  emitSettingsChanged(req.storeId);
  emitStoresChanged();
  res.json(settingsPayload(req.storeId));
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
  const store = getStoreRow(req.storeId);
  if (store.use_shared_qris) {
    setSetting('qris_payload', info.payload);
    emitSettingsChanged(null);
  } else {
    db.prepare('UPDATE stores SET qris_payload = ? WHERE id = ?').run(info.payload, req.storeId);
    emitSettingsChanged(req.storeId);
  }
  res.json(settingsPayload(req.storeId));
});

router.delete('/settings/qris', requireAdmin, (req, res) => {
  const store = getStoreRow(req.storeId);
  if (store.use_shared_qris) {
    setSetting('qris_payload', null);
    emitSettingsChanged(null);
  } else {
    db.prepare('UPDATE stores SET qris_payload = NULL WHERE id = ?').run(req.storeId);
    emitSettingsChanged(req.storeId);
  }
  res.json(settingsPayload(req.storeId));
});

router.post('/settings/banks', requireAdmin, (req, res) => {
  const bank = readBank(req.body);
  const shared = isUsingSharedBanks(req.storeId);
  db.prepare('INSERT INTO bank_accounts (store_id, bank_name, account_number, account_name, created_at) VALUES (?, ?, ?, ?, ?)').run(
    shared ? null : req.storeId, bank.bankName, bank.accountNumber, bank.accountName, Date.now()
  );
  emitSettingsChanged(shared ? null : req.storeId);
  res.status(201).json(settingsPayload(req.storeId));
});

router.put('/settings/banks/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const bank = readBank(req.body);
  const shared = isUsingSharedBanks(req.storeId);
  const result = shared
    ? db
        .prepare('UPDATE bank_accounts SET bank_name = ?, account_number = ?, account_name = ? WHERE id = ? AND store_id IS NULL')
        .run(bank.bankName, bank.accountNumber, bank.accountName, id)
    : db
        .prepare('UPDATE bank_accounts SET bank_name = ?, account_number = ?, account_name = ? WHERE id = ? AND store_id = ?')
        .run(bank.bankName, bank.accountNumber, bank.accountName, id, req.storeId);
  if (result.changes === 0) throw httpError(404, 'Rekening tidak ditemukan');
  emitSettingsChanged(shared ? null : req.storeId);
  res.json(settingsPayload(req.storeId));
});

router.delete('/settings/banks/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const shared = isUsingSharedBanks(req.storeId);
  const result = shared
    ? db.prepare('DELETE FROM bank_accounts WHERE id = ? AND store_id IS NULL').run(id)
    : db.prepare('DELETE FROM bank_accounts WHERE id = ? AND store_id = ?').run(id, req.storeId);
  if (result.changes === 0) throw httpError(404, 'Rekening tidak ditemukan');
  emitSettingsChanged(shared ? null : req.storeId);
  res.json(settingsPayload(req.storeId));
});

// ---------- Auto-confirm from payment notifications ----------

function autoConfirmPayload(req) {
  const port = req.socket.localPort;
  const store = getStoreRow(req.storeId);
  const ac = getAutoConfirmSettings(req.storeId);
  const token = getNotifyToken(req.storeId);
  return {
    ...ac,
    storeName: store.name,
    sharedStoreNames: listSharedAutoConfirmStores().map((s) => s.name),
    defaultIgnoreWords: DEFAULT_IGNORE_WORDS,
    webhookPath: `/api/notify/${token}`,
    lanUrls: lanAddresses().map((ip) => `http://${ip}:${port}`),
    recent: recentNotifications(20, { scope: ac.scope, storeId: req.storeId }),
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
  const ignoreWords = str(body.ignoreWords, { field: 'Kata yang diabaikan', max: 300 });
  const store = getStoreRow(req.storeId);
  if (store.use_shared_autoconfirm) {
    setSetting('autoconfirm_enabled', body.enabled ? '1' : '0');
    setSetting('autoconfirm_window', String(windowMinutes));
    setSetting('autoconfirm_ignore', ignoreWords);
    emitSettingsChanged(null);
  } else {
    db.prepare(`
      UPDATE stores SET autoconfirm_enabled = ?, autoconfirm_window = ?, autoconfirm_ignore = ?
      WHERE id = ?
    `).run(body.enabled ? 1 : 0, windowMinutes, ignoreWords, req.storeId);
    emitSettingsChanged(req.storeId);
  }
  res.json(autoConfirmPayload(req));
});

router.post('/settings/autoconfirm/regenerate', requireAdmin, (req, res) => {
  regenerateNotifyToken(req.storeId);
  res.json(autoConfirmPayload(req));
});

// Dry run: what would happen with this notification text right now (changes nothing).
router.post('/settings/autoconfirm/test', requireAdmin, (req, res) => {
  const text = str(req.body?.text, { field: 'Teks notifikasi', required: true, max: 1000 });
  const ac = getAutoConfirmSettings(req.storeId);
  const outcome = evaluateNotification(
    { source: 'Uji coba', text },
    { scope: ac.scope, storeId: req.storeId, dryRun: true }
  );
  res.json({
    result: outcome.result,
    detail: outcome.detail,
    amounts: outcome.amounts,
    transaction: outcome.transaction
      ? { code: outcome.transaction.code, total: outcome.transaction.total, storeName: outcome.transaction.storeName }
      : null,
    candidates: outcome.candidates.map((t) => t.code),
  });
});

// ---------- Customer display pairing ----------

router.get('/display', requireAuth, (req, res) => {
  const port = req.socket.localPort;
  const store = getStoreRow(req.storeId);
  res.json({
    key: formatDisplayKey(getDisplayKey(req.storeId)),
    storeName: store.name,
    lanUrls: lanAddresses().map((ip) => `http://${ip}:${port}`),
  });
});

router.post('/display/regenerate', requireAdmin, (req, res) => {
  const key = regenerateDisplayKey(req.storeId);
  disconnectDisplays(req.storeId);
  res.json({ key: formatDisplayKey(key) });
});

export { lanAddresses };
export default router;
