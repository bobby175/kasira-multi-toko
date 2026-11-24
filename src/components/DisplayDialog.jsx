import { useEffect, useState } from 'react';
import { Copy, ExternalLink, MonitorSmartphone, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { copyText } from '../lib/media.js';
import { Modal, QRImage, Spinner, useConfirm, useToast } from './ui.jsx';

const isLocalHost = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);

/** Pair another device (PC / tablet / HP) as the customer-facing display. */
export function DisplayDialog({ open, onClose, isAdmin }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [info, setInfo] = useState(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api('/display')
      .then(setInfo)
      .catch((e) => toast.error(e.message));
  }, [open, toast]);

  const origins = (() => {
    if (!info) return [];
    const list = [];
    if (!isLocalHost(window.location.hostname)) list.push(window.location.origin);
    for (const url of info.lanUrls) if (!list.includes(url)) list.push(url);
    if (list.length === 0) list.push(window.location.origin);
    return list;
  })();
  const origin = origins[Math.min(selected, origins.length - 1)];
  const pairUrl = info ? `${origin}/display?key=${info.key}` : '';

  const regenerate = async () => {
    const ok = await confirm({
      title: 'Ganti kode layar?',
      message: 'Semua layar pelanggan yang sedang terhubung akan terputus dan perlu dipasangkan ulang.',
      confirmLabel: 'Ganti kode',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { key } = await api('/display/regenerate', { method: 'POST' });
      setInfo((i) => ({ ...i, key }));
      toast.success('Kode layar baru dibuat');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Layar Pelanggan" subtitle="Tampilkan pembayaran ke pelanggan secara real-time di perangkat lain.">
      {!info ? (
        <div className="grid place-items-center py-16 text-slate-400"><Spinner className="size-7" /></div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
          <div className="flex flex-col items-center">
            <div className="rounded-3xl bg-white p-3 shadow-lg ring-1 ring-slate-200">
              <QRImage value={pairUrl} className="size-48" size={480} />
            </div>
            <p className="mt-2 text-center text-xs text-slate-500">Scan dengan kamera tablet / HP pelanggan</p>
          </div>
          <div className="space-y-4">
            <div>
              <div className="label">Kode layar</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.25em] text-white">
                  {info.key}
                </div>
                <button
                  type="button"
                  className="btn-icon border border-slate-200"
                  aria-label="Salin kode"
                  onClick={async () => {
                    if (await copyText(info.key)) toast.success('Kode disalin');
                    else toast.error('Gagal menyalin');
                  }}
                >
                  <Copy className="size-4" />
                </button>
              </div>
            </div>
            <div>
              <div className="label">Atau buka alamat ini di perangkat layar</div>
              {origins.length > 1 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {origins.map((o, i) => (
                    <button key={o} type="button" onClick={() => setSelected(i)} className={`chip text-xs ${i === selected ? 'chip-on' : 'chip-off'}`}>
                      {o.replace(/^https?:\/\//, '')}
                    </button>
                  ))}
                </div>
              )}
              <div className="break-all rounded-xl bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700 ring-1 ring-slate-200">
                {origin}/display
              </div>
              <p className="hint">Lalu masukkan kode layar di atas. Perangkat harus terhubung ke jaringan yang sama.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`/display?key=${info.key}`} target="_blank" rel="noreferrer" className="btn btn-primary">
                <ExternalLink className="size-4" /> Buka di perangkat ini
              </a>
              {isAdmin && (
                <button type="button" className="btn btn-secondary" onClick={regenerate} disabled={busy}>
                  <RefreshCw className="size-4" /> Ganti kode
                </button>
              )}
            </div>
            <div className="flex gap-3 rounded-2xl bg-emerald-50 p-3 text-xs text-emerald-900 ring-1 ring-emerald-200">
              <ShieldCheck className="size-5 shrink-0 text-emerald-600" />
              <span>
                Layar pelanggan hanya menampilkan informasi pembayaran. Tidak ada tombol konfirmasi; persetujuan pembayaran hanya bisa dilakukan oleh karyawan/admin yang login.
              </span>
            </div>
          </div>
        </div>
      )}
      <div className="mt-5 flex items-start gap-2 text-xs text-slate-500">
        <MonitorSmartphone className="size-4 shrink-0" />
        Tips PC dengan 2 monitor: klik “Buka di perangkat ini”, geser jendela ke monitor pelanggan, lalu tekan F11.
      </div>
    </Modal>
  );
}
