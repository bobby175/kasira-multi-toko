import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, History, Printer, ReceiptText, Search, TrendingUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { dayRange, formatDateLong, formatTime, rupiah, toDateInputValue } from '../lib/format.js';
import { useData } from '../state/data.jsx';
import { PageHeader } from '../components/Shell.jsx';
import { printReceipt } from '../components/Receipt.jsx';
import { EmptyState, MethodBadge, Spinner, StatusPill, useToast } from '../components/ui.jsx';

const FILTERS = [
  { id: '', label: 'Semua' },
  { id: 'paid', label: 'Lunas' },
  { id: 'pending', label: 'Menunggu' },
  { id: 'cancelled', label: 'Batal' },
];

function StatCard({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className={`absolute -top-6 -right-6 size-20 rounded-full opacity-15 blur-xl ${tone}`} />
      <div className={`mb-3 grid size-9 place-items-center rounded-xl text-white ${tone}`}>
        <Icon className="size-[18px]" />
      </div>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-extrabold tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function HistoryPage() {
  const { openTx, upsertTx, txMap, settings, subscribeTx } = useData();
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const silentReload = useRef(false);
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [list, setList] = useState([]);
  const [summary, setSummary] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const range = useMemo(() => dayRange(new Date(`${date}T00:00:00`)), [date]);

  // Refresh list + totals when a transaction of this day changes on any device.
  useEffect(
    () =>
      subscribeTx(({ tx }) => {
        if (tx.createdAt >= range.from && tx.createdAt < range.to) {
          silentReload.current = true;
          setReloadKey((k) => k + 1);
        }
      }),
    [subscribeTx, range]
  );

  const fetchPage = useCallback(
    async (before) => {
      const params = new URLSearchParams({ from: range.from, to: range.to, limit: 40 });
      if (status) params.set('status', status);
      if (debounced) params.set('q', debounced);
      if (before) params.set('before', before);
      return api(`/transactions?${params}`);
    },
    [range, status, debounced]
  );

  useEffect(() => {
    let alive = true;
    if (!silentReload.current) setLoading(true);
    silentReload.current = false;
    fetchPage()
      .then((data) => {
        if (!alive) return;
        setList(data.transactions);
        setHasMore(data.hasMore);
        setSummary(data.summary || []);
      })
      .catch((e) => alive && toast.error(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [fetchPage, toast, reloadKey]);

  // Reflect realtime status changes (e.g. confirmed on another device) in the visible list.
  const rows = list.map((tx) => txMap[tx.id] ?? tx);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await fetchPage(list[list.length - 1]?.id);
      setList((l) => [...l, ...data.transactions]);
      setHasMore(data.hasMore);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const shiftDay = (delta) => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(toDateInputValue(d));
  };

  const sum = (fn) => summary.filter(fn).reduce((acc, s) => ({ count: acc.count + s.count, amount: acc.amount + s.amount }), { count: 0, amount: 0 });
  const paid = sum((s) => s.status === 'paid');
  const paidQris = sum((s) => s.status === 'paid' && s.method === 'qris');
  const paidTransfer = sum((s) => s.status === 'paid' && s.method === 'transfer');
  const waiting = sum((s) => s.status === 'pending');
  const isToday = date === toDateInputValue(new Date());

  const open = (tx) => {
    upsertTx(tx);
    openTx(tx.id);
  };

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8 short:px-5 short:py-4">
      <PageHeader
        title="Riwayat Transaksi"
        description={formatDateLong(range.from)}
        actions={
          <div className="flex items-center gap-1 rounded-2xl bg-white p-1 shadow-xs ring-1 ring-slate-200">
            <button type="button" className="btn-icon size-9" onClick={() => shiftDay(-1)} aria-label="Hari sebelumnya">
              <ChevronLeft className="size-5" />
            </button>
            <label className="relative flex items-center gap-2 px-2 text-sm font-semibold text-slate-700">
              <CalendarDays className="size-4 text-brand-600" />
              <input type="date" value={date} max={toDateInputValue(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} className="bg-transparent text-sm outline-hidden" />
            </label>
            <button type="button" className="btn-icon size-9" onClick={() => shiftDay(1)} disabled={isToday} aria-label="Hari berikutnya">
              <ChevronRight className="size-5" />
            </button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={TrendingUp} label="Pendapatan lunas" value={rupiah(paid.amount)} sub={`${paid.count} transaksi`} tone="bg-linear-to-br from-emerald-500 to-teal-600" />
        <StatCard icon={ReceiptText} label="Via QRIS" value={rupiah(paidQris.amount)} sub={`${paidQris.count} transaksi`} tone="bg-linear-to-br from-brand-500 to-fuchsia-500" />
        <StatCard icon={ReceiptText} label="Via Transfer" value={rupiah(paidTransfer.amount)} sub={`${paidTransfer.count} transaksi`} tone="bg-linear-to-br from-sky-500 to-indigo-600" />
        <StatCard icon={Clock3} label="Menunggu" value={waiting.count} sub={rupiah(waiting.amount)} tone="bg-linear-to-br from-amber-400 to-orange-500" />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="scrollbar-none flex gap-2 overflow-x-auto">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setStatus(f.id)} className={`chip ${status === f.id ? 'chip-on' : 'chip-off'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative sm:ml-auto sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari kode transaksi" className="input py-2 pl-9 text-sm" />
          </div>
        </div>

        {loading ? (
          <div className="grid place-items-center py-16 text-slate-400"><Spinner className="size-7" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={History} title="Belum ada transaksi" description="Transaksi pada tanggal ini akan muncul di sini." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((tx) => (
              <li key={tx.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 sm:px-5">
                <button type="button" onClick={() => open(tx)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <div className="hidden w-14 shrink-0 text-sm font-semibold text-slate-500 sm:block">{formatTime(tx.createdAt)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{tx.code}</span>
                      <StatusPill status={tx.status} />
                      {tx.confirmSource === 'auto' && (
                        <span className="pill bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" title="Dikonfirmasi otomatis dari notifikasi pembayaran">
                          Otomatis
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      <span className="sm:hidden">{formatTime(tx.createdAt)} • </span>
                      {tx.itemCount} item • {tx.createdBy.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-extrabold text-slate-900">{rupiah(tx.total)}</div>
                    <MethodBadge method={tx.method} className="mt-1" />
                  </div>
                </button>
                {tx.status === 'paid' && (
                  <button type="button" onClick={() => printReceipt(tx, settings.store)} className="btn-icon shrink-0" aria-label="Cetak struk" title="Cetak struk">
                    <Printer className="size-[18px]" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {hasMore && !loading && (
          <div className="border-t border-slate-100 p-4 text-center">
            <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
              {loadingMore && <Spinner className="size-4" />} Muat lebih banyak
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
