// Webhook for payment notifications forwarded from an Android phone (MacroDroid, Tasker, ...).
// Authenticated by a secret token in the URL (no cookies), so it is mounted outside the CSRF guard.
// Supports both the shared (Pusat / Tetap) token and store-specific tokens.
import express, { Router } from 'express';
import { rateLimit } from '../auth.js';
import {
  extractNotification, evaluateNotification, logNotification, pendingStoreIdsIn,
  resolveNotifyTarget, targetStoreIdsForScope,
} from '../notify.js';
import { emitToAdmins, emitToStaff, txUpdated } from '../realtime.js';

// Who confirmed: shown on staff devices and the receipt.
const AUTO_ACTOR = { user: { id: null, name: 'Otomatis' }, get: () => null };

const router = Router();

router.post('/:token', express.text({ type: () => true, limit: '16kb' }), (req, res) => {
  const ip = req.ip;
  const target = resolveNotifyTarget(req.params.token);
  if (!target) {
    const allowed = rateLimit(`notify-bad:${ip}`, 20, 10 * 60 * 1000);
    return res.status(allowed ? 404 : 429).json({ error: allowed ? 'Tidak ditemukan' : 'Terlalu banyak percobaan' });
  }
  if (!rateLimit(`notify:${ip}`, 120, 60 * 1000)) return res.status(429).json({ error: 'Terlalu banyak notifikasi' });

  const logStoreId = target.scope === 'store' ? target.storeId : null;
  const notifyStores = targetStoreIdsForScope(target);

  const notification = extractNotification(req.body, req.get('content-type') || '');
  if (!notification.text) {
    // e.g. MacroDroid "Test actions": magic text is empty. Record it so the admin can see the phone got through.
    logNotification(
      notification,
      { amounts: [], result: 'test', transaction: null, detail: 'Tes koneksi berhasil (tanpa teks notifikasi)' },
      { storeId: logStoreId }
    );
    for (const sid of notifyStores) emitToStaff(sid, 'notify:received', { result: 'test' });
    emitToAdmins('notify:received', { result: 'test' });
    return res.json({ ok: true, result: 'test' });
  }

  const outcome = evaluateNotification(notification, { scope: target.scope, storeId: target.storeId });
  if (outcome.result !== 'duplicate') logNotification(notification, outcome, { storeId: logStoreId });

  if (outcome.result === 'confirmed') {
    txUpdated(outcome.transaction, 'confirmed', AUTO_ACTOR);
  } else if (outcome.result === 'ambiguous') {
    const affectedStoreIds = [...new Set(outcome.candidates.map((t) => t.storeId))];
    for (const sid of affectedStoreIds) {
      const storeCodes = outcome.candidates.filter((t) => t.storeId === sid).map((t) => t.code);
      emitToStaff(sid, 'notify:attention', {
        amounts: outcome.amounts,
        detail: outcome.detail,
        codes: storeCodes.length ? storeCodes : outcome.candidates.map((t) => t.code),
      });
    }
  } else if (outcome.result === 'no_match') {
    const activePendingStores = pendingStoreIdsIn(outcome.targetStoreIds);
    for (const sid of activePendingStores) {
      emitToStaff(sid, 'notify:attention', {
        amounts: outcome.amounts,
        detail: outcome.detail,
        codes: [],
      });
    }
  }

  for (const sid of outcome.targetStoreIds) emitToStaff(sid, 'notify:received', { result: outcome.result });
  emitToAdmins('notify:received', { result: outcome.result });

  res.json({ ok: true, result: outcome.result, transaction: outcome.transaction?.code ?? null });
});

export default router;
