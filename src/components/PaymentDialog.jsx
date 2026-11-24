import { useState } from 'react';
import {
  BadgeCheck, Ban, CheckCircle2, Landmark, MonitorUp, Printer, QrCode, RotateCcw, ShoppingBag, XCircle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDateTime, formatTime, rupiah } from '../lib/format.js';
import { navigate } from '../lib/router.jsx';
import { playChime } from '../lib/sound.js';
import { useData } from '../state/data.jsx';
import { PaymentInstructions } from './PaymentInstructions.jsx';
import { printReceipt } from './Receipt.jsx';
import { Modal, Spinner, StatusPill, useConfirm, useToast } from './ui.jsx';

export function SuccessBadge({ className = 'size-24' }) {
  return (
    <div className={`relative grid place-items-center ${className}`}>
      <span className="absolute inset-0 animate-ring rounded-full bg-emerald-400/40" />
      <span className="absolute inset-0 rounded-full bg-linear-to-br from-emerald-400 to-teal-500 shadow-xl shadow-emerald-500/40" />
      <svg viewBox="0 0 24 24" className="relative size-1/2 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="48" className="animate-check" />
      </svg>
    </div>
  );
}

function OrderSummary({ tx }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4 text-left ring-1 ring-slate-200/70 short:px-3 short:py-2.5">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 short:mb-0">
        <ShoppingBag className="size-3.5" /> Pesanan • {tx.itemCount} item
      </div>
      {/* On short landscape screens only the total is shown; the item list is on the customer display. */}
      <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1 text-sm short:hidden">
        {tx.items.map((item, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="min-w-0 text-slate-700">
              <span className="font-semibold text-slate-900">{item.qty}×</span> {item.name}
            </span>
            <span className="shrink-0 font-medium text-slate-700">{rupiah(item.subtotal)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-slate-300 pt-3 short:mt-0 short:border-0 short:pt-0">
        <span className="font-semibold text-slate-600">Total</span>
        <span className="text-xl font-extrabold text-slate-900 short:text-2xl">{rupiah(tx.total)}</span>
      </div>
    </div>
  );
}

function MethodSwitch({ tx, settings, busy, onChange }) {
  const options = [
    { id: 'qris', label: 'QRIS', icon: QrCode, ok: settings.qris.configured },
    { id: 'transfer', label: 'Transfer', icon: Landmark, ok: settings.banks.length > 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
      {options.map(({ id, label, icon: Icon, ok }) => (
        <button
          key={id}
          type="button"
          disabled={busy || !ok || tx.method === id}
          onClick={() => onChange(id)}
          className={`flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold transition ${
            tx.method === id ? 'bg-white text-slate-900 shadow-sm disabled:opacity-100' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Icon className="size-4" /> {label}
        </button>
      ))}
    </div>
  );
}

export function PaymentDialog() {
  const { activeTxId, txMap, closeTx, upsertTx, settings, cartApi, productMap } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(null);

  const tx = activeTxId ? txMap[activeTxId] : null;
  if (!tx) return null;

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const confirmPaid = async () => {
    const ok = await confirm({
      title: 'Pembayaran sudah masuk?',
      message: (
        <>
          Pastikan dana <b className="text-slate-900">{rupiah(tx.total)}</b> sudah diterima di{' '}
          {tx.method === 'qris' ? 'aplikasi merchant QRIS' : 'mutasi rekening bank'} sebelum konfirmasi.
        </>
      ),
      confirmLabel: 'Ya, sudah masuk',
      tone: 'success',
      icon: BadgeCheck,
    });
    if (!ok) return;
    run('confirm', async () => {
      const { transaction } = await api(`/transactions/${tx.id}/confirm`, { method: 'POST' });
      upsertTx(transaction);
      playChime('success');
    });
  };

  const cancelTx = async () => {
    const ok = await confirm({
      title: 'Batalkan transaksi?',
      message: `${tx.code} akan dibatalkan dan hilang dari layar pelanggan.`,
      confirmLabel: 'Batalkan',
      cancelLabel: 'Kembali',
      tone: 'danger',
    });
    if (!ok) return;
    run('cancel', async () => {
      const { transaction } = await api(`/transactions/${tx.id}/cancel`, { method: 'POST' });
      upsertTx(transaction);
    });
  };

  const changeMethod = (method) =>
    run('method', async () => {
      const { transaction } = await api(`/transactions/${tx.id}/method`, { method: 'POST', body: { method } });
      upsertTx(transaction);
    });

  const showOnDisplay = () =>
    run('display', async () => {
      await api(`/transactions/${tx.id}/display`, { method: 'POST' });
      toast.success('Ditampilkan di layar pelanggan');
    });

  const restoreCart = () => {
    const items = tx.items.filter((i) => productMap[i.productId]).map((i) => ({ productId: i.productId, qty: i.qty }));
    cartApi.replace(items);
    closeTx();
    navigate('/');
  };

  const newTransaction = () => {
    closeTx();
    navigate('/');
  };

  const pendingView = (
    <div className="grid gap-6 md:grid-cols-[1.1fr_1fr] md:items-start short:grid-cols-[auto_minmax(0,1fr)] short:gap-4">
      <div className="rounded-3xl bg-linear-to-b from-slate-50 to-white p-4 ring-1 ring-slate-200/70 sm:p-6 short:bg-none short:p-0 short:ring-0">
        <PaymentInstructions
          method={tx.method}
          total={tx.total}
          qrisPayload={tx.qrisPayload}
          qris={settings.qris}
          banks={settings.banks}
        />
      </div>
      <div className="flex flex-col gap-4 short:gap-2.5">
        <div className="flex items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 short:hidden">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
          </span>
          {settings.autoConfirm?.enabled ? (
            <span>
              <b>Konfirmasi otomatis aktif.</b> Pembayaran lunas sendiri saat notifikasi masuk. Tombol manual tetap bisa dipakai.
            </span>
          ) : (
            <span>
              Menunggu pembayaran pelanggan. Cek {tx.method === 'qris' ? 'notifikasi QRIS' : 'mutasi rekening'}, lalu konfirmasi.
            </span>
          )}
        </div>
        <MethodSwitch tx={tx} settings={settings} busy={Boolean(busy)} onChange={changeMethod} />
        <OrderSummary tx={tx} />
        <button type="button" className="btn btn-success btn-lg w-full short:rounded-xl short:py-3 short:text-sm" disabled={Boolean(busy)} onClick={confirmPaid}>
          {busy === 'confirm' ? <Spinner /> : <BadgeCheck className="size-5" />}
          Konfirmasi Pembayaran Diterima
        </button>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={showOnDisplay}>
            {busy === 'display' ? <Spinner className="size-4" /> : <MonitorUp className="size-4" />}
            <span className="short:hidden">Tampilkan di Layar</span>
            <span className="hidden short:inline">Ke Layar</span>
          </button>
          <button type="button" className="btn btn-danger" disabled={Boolean(busy)} onClick={cancelTx}>
            {busy === 'cancel' ? <Spinner className="size-4" /> : <Ban className="size-4" />} Batalkan
          </button>
        </div>
        <p className="text-center text-xs text-slate-400 short:hidden">
          Dibuat oleh {tx.createdBy?.name} • {formatTime(tx.createdAt)}. Tutup jendela ini untuk melayani pelanggan lain; transaksi tetap menunggu di menu Pembayaran.
        </p>
      </div>
    </div>
  );

  const paidView = (
    <div className="mx-auto flex max-w-md flex-col items-center py-4 text-center short:grid short:max-w-none short:grid-cols-2 short:items-center short:gap-5 short:py-1">
      <div className="flex flex-col items-center">
        <SuccessBadge className="size-24 short:size-16" />
        <h3 className="mt-6 text-2xl font-extrabold text-slate-900 short:mt-3 short:text-xl">Pembayaran Lunas</h3>
        <p className="mt-1 text-sm text-slate-500 short:text-xs">
          {tx.confirmSource === 'auto' ? (
            <>Dikonfirmasi <b className="text-emerald-700">otomatis dari notifikasi</b></>
          ) : (
            <>Dikonfirmasi oleh <b className="text-slate-700">{tx.confirmedBy?.name}</b></>
          )}{' '}
          • {formatTime(tx.confirmedAt)}
        </p>
        <div className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900 short:mt-2 short:text-3xl">{rupiah(tx.total)}</div>
      </div>
      <div className="w-full">
        <div className="mt-6 w-full short:hidden">
          <OrderSummary tx={tx} />
        </div>
        <div className="mt-6 grid w-full gap-3 sm:grid-cols-2 short:mt-0 short:grid-cols-1 short:gap-2.5">
          <button type="button" className="btn btn-primary btn-lg short:rounded-xl short:py-2.5 short:text-sm" onClick={() => printReceipt(tx, settings.store)}>
            <Printer className="size-5" /> Cetak Struk
          </button>
          <button type="button" className="btn btn-secondary btn-lg short:rounded-xl short:py-2.5 short:text-sm" onClick={newTransaction}>
            <CheckCircle2 className="size-5" /> Transaksi Baru
          </button>
        </div>
      </div>
    </div>
  );

  const cancelledView = (
    <div className="mx-auto flex max-w-md flex-col items-center py-6 text-center short:py-2">
      <div className="grid size-20 place-items-center rounded-full bg-slate-100 text-slate-400 short:size-14">
        <XCircle className="size-10 short:size-7" />
      </div>
      <h3 className="mt-5 text-xl font-extrabold text-slate-900 short:mt-3">Transaksi Dibatalkan</h3>
      <p className="mt-1 text-sm text-slate-500">
        oleh {tx.cancelledBy?.name} • {tx.cancelledAt ? formatDateTime(tx.cancelledAt) : ''}
      </p>
      <div className="mt-6 grid w-full gap-3 sm:grid-cols-2 short:mt-4">
        <button type="button" className="btn btn-secondary btn-lg" onClick={restoreCart}>
          <RotateCcw className="size-5" /> Ke keranjang lagi
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={closeTx}>
          Tutup
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      open
      onClose={closeTx}
      size={tx.status === 'pending' ? 'xl' : 'md'}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {tx.code} <StatusPill status={tx.status} />
        </span>
      }
      subtitle={<span className="short:hidden">{formatDateTime(tx.createdAt)}</span>}
    >
      {tx.status === 'pending' ? pendingView : tx.status === 'paid' ? paidView : cancelledView}
    </Modal>
  );
}
