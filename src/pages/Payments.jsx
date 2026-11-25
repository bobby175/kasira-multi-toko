import { useEffect, useState } from 'react';
import { BadgeCheck, Clock3, Eye, Radio, Wallet } from 'lucide-react';
import { api } from '../lib/api.js';
import { rupiah, timeAgo } from '../lib/format.js';
import { playChime } from '../lib/sound.js';
import { useData } from '../state/data.jsx';
import { PageHeader } from '../components/Shell.jsx';
import { Avatar, EmptyState, MethodBadge, Spinner, useConfirm, useToast } from '../components/ui.jsx';

function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function PaymentsPage() {
  const { pending, openTx, upsertTx, connected, settings, stores } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNow();
  const [busyId, setBusyId] = useState(null);

  const quickConfirm = async (tx) => {
    const ok = await confirm({
      title: 'Pembayaran sudah masuk?',
      message: (
        <>
          {tx.code} • <b className="text-slate-900">{rupiah(tx.total)}</b> via {tx.method === 'qris' ? 'QRIS' : 'transfer bank'}.
          Pastikan dana sudah diterima.
        </>
      ),
      confirmLabel: 'Ya, sudah masuk',
      tone: 'success',
      icon: BadgeCheck,
    });
    if (!ok) return;
    setBusyId(tx.id);
    try {
      const { transaction } = await api(`/transactions/${tx.id}/confirm`, { method: 'POST' });
      upsertTx(transaction);
      playChime('success');
      openTx(transaction.id); // show success screen with the "Cetak Struk" option
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8 short:px-5 short:py-4">
      <PageHeader
        title="Pembayaran"
        description={
          stores.length > 1 && settings.store.name
            ? `Pembayaran menunggu konfirmasi untuk ${settings.store.name}. Ter-update otomatis.`
            : 'Daftar pembayaran yang menunggu konfirmasi dari semua perangkat. Ter-update otomatis.'
        }
        actions={
          <span className={`pill ${connected ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'}`}>
            <Radio className="size-3.5" /> {connected ? 'Real-time aktif' : 'Menyambung ulang...'}
          </span>
        }
      />

      {pending.length === 0 ? (
        <div className="card">
          <EmptyState icon={Wallet} title="Tidak ada pembayaran yang menunggu" description="Saat kasir membuat pembayaran di HP, tablet, atau PC mana pun, pembayaran akan muncul di sini secara real-time." />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {pending.map((tx) => (
            <article key={tx.id} className="card animate-pop-in overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-linear-to-r from-amber-50 to-white px-5 py-3">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <span className="relative flex size-2.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
                  </span>
                  {tx.code}
                </div>
                <MethodBadge method={tx.method} />
              </div>
              <div className="px-5 py-4">
                <div className="text-3xl font-extrabold tracking-tight text-slate-900">{rupiah(tx.total)}</div>
                <div className="mt-1 line-clamp-1 text-sm text-slate-500">
                  {tx.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                  <Avatar name={tx.createdBy.name} className="size-6 text-[10px]" />
                  <span className="font-semibold text-slate-700">{tx.createdBy.name}</span>
                  <span>•</span>
                  <Clock3 className="size-3.5" /> {timeAgo(tx.createdAt, now)}
                </div>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-2 px-5 pb-5">
                <button type="button" className="btn btn-secondary" onClick={() => openTx(tx.id)}>
                  <Eye className="size-4" /> Detail
                </button>
                <button type="button" className="btn btn-success" disabled={busyId === tx.id} onClick={() => quickConfirm(tx)}>
                  {busyId === tx.id ? <Spinner className="size-4" /> : <BadgeCheck className="size-4" />} Konfirmasi Diterima
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
