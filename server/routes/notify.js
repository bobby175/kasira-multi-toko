// Webhook for payment notifications forwarded from an Android phone (MacroDroid, Tasker, ...).
// Authenticated by a secret token in the URL (no cookies), so it is mounted outside the CSRF guard.
import express, { Router } from 'express';
import { rateLimit } from '../auth.js';
import { extractNotification, evaluateNotification, hasPendingTransactions, isValidNotifyToken, logNotification } from '../notify.js';
import { emitToStaff, txUpdated } from '../realtime.js';

// Who confirmed: shown on staff devices and the receipt.
const AUTO_ACTOR = { user: { id: null, name: 'Otomatis' }, get: () => null };

const router = Router();

router.post('/:token', express.text({ type: () => true, limit: '16kb' }), (req, res) => {
  const ip = req.ip;
  if (!isValidNotifyToken(req.params.token)) {
    const allowed = rateLimit(`notify-bad:${ip}`, 20, 10 * 60 * 1000);
    return res.status(allowed ? 404 : 429).json({ error: allowed ? 'Tidak ditemukan' : 'Terlalu banyak percobaan' });
  }
  if (!rateLimit(`notify:${ip}`, 120, 60 * 1000)) return res.status(429).json({ error: 'Terlalu banyak notifikasi' });

  const notification = extractNotification(req.body, req.get('content-type') || '');
  if (!notification.text) {
    // e.g. MacroDroid "Test actions": magic text is empty. Record it so the admin can see the phone got through.
    logNotification(notification, { amounts: [], result: 'test', transaction: null, detail: 'Tes koneksi berhasil (tanpa teks notifikasi)' });
    emitToStaff('notify:received', { result: 'test' });
    return res.json({ ok: true, result: 'test' });
  }

  const outcome = evaluateNotification(notification);
  if (outcome.result !== 'duplicate') logNotification(notification, outcome);

  if (outcome.result === 'confirmed') {
    txUpdated(outcome.transaction, 'confirmed', AUTO_ACTOR);
  } else if (outcome.result === 'ambiguous' || (outcome.result === 'no_match' && hasPendingTransactions())) {
    // A payment probably arrived but could not be matched safely: ask staff to check.
    emitToStaff('notify:attention', {
      amounts: outcome.amounts,
      detail: outcome.detail,
      codes: outcome.candidates.map((t) => t.code),
    });
  }
  emitToStaff('notify:received', { result: outcome.result });

  res.json({ ok: true, result: outcome.result, transaction: outcome.transaction?.code ?? null });
});

export default router;
