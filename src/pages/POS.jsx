import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, ChevronRight, Landmark, Minus, MonitorSmartphone, PackagePlus, Plus, QrCode, Search, ShoppingBag, Trash2, Wallet, X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDateLong, rupiah } from '../lib/format.js';
import { Link, navigate } from '../lib/router.jsx';
import { useShortScreen } from '../lib/screen.js';
import { useAuth } from '../state/auth.jsx';
import { useData } from '../state/data.jsx';
import { EmptyState, Modal, ProductThumb, Spinner, useToast } from '../components/ui.jsx';

function ProductCard({ product, qty, onAdd }) {
  const [bump, setBump] = useState(0);
  return (
    <button
      type="button"
      onClick={() => {
        onAdd();
        setBump((b) => b + 1);
      }}
      className={`group relative flex flex-col overflow-hidden rounded-2xl bg-white text-left shadow-xs ring-1 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/5 ${
        qty ? 'ring-2 ring-brand-500' : 'ring-slate-200/80'
      }`}
    >
      <div key={bump} className={bump ? 'animate-bump' : ''}>
        <ProductThumb product={product} className="aspect-[4/3] w-full text-xl transition duration-300 group-hover:scale-[1.03] short:aspect-[16/9] short:text-lg" />
      </div>
      {qty > 0 && (
        <span className="absolute top-2 right-2 grid min-w-8 animate-pop-in place-items-center rounded-full bg-brand-600 px-2 py-1 text-sm font-extrabold text-white shadow-lg shadow-brand-600/40 short:top-1.5 short:right-1.5 short:min-w-7 short:py-0.5">
          {qty}
        </span>
      )}
      <div className="flex flex-1 flex-col p-3 short:p-2.5">
        <div className="line-clamp-2 text-sm leading-snug font-semibold text-slate-800 short:text-[13px]">{product.name}</div>
        <div className="mt-auto flex items-center justify-between pt-2 short:pt-1.5">
          <span className="text-[15px] font-extrabold text-brand-700 short:text-sm">{rupiah(product.price)}</span>
          <span className="grid size-7 place-items-center rounded-full bg-slate-100 text-slate-500 transition group-hover:bg-brand-600 group-hover:text-white">
            <Plus className="size-4" />
          </span>
        </div>
      </div>
    </button>
  );
}

function CartLines({ lines, cartApi }) {
  return (
    <ul className="divide-y divide-slate-100">
      {lines.map(({ product, qty, subtotal }) => (
        <li key={product.id} className="flex items-center gap-3 py-3 short:gap-2 short:py-2">
          <ProductThumb product={product} className="size-12 shrink-0 rounded-xl text-[11px] short:hidden" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800 short:text-[13px]">{product.name}</div>
            <div className="text-xs text-slate-500 short:hidden">{rupiah(product.price)}</div>
            <div className="mt-0.5 text-sm font-bold text-slate-900 short:mt-0 short:text-[13px]">{rupiah(subtotal)}</div>
          </div>
          <div className="flex shrink-0 items-center rounded-full bg-slate-100 p-1 short:p-0.5">
            <button
              type="button"
              aria-label="Kurangi"
              onClick={() => cartApi.setQty(product.id, qty - 1)}
              className="grid size-8 place-items-center rounded-full text-slate-600 transition hover:bg-white hover:shadow-sm short:size-7"
            >
              {qty === 1 ? <Trash2 className="size-4 text-rose-500" /> : <Minus className="size-4" />}
            </button>
            <span className="w-8 text-center text-sm font-bold tabular-nums short:w-6">{qty}</span>
            <button
              type="button"
              aria-label="Tambah"
              onClick={() => cartApi.setQty(product.id, qty + 1)}
              className="grid size-8 place-items-center rounded-full bg-white text-brand-600 shadow-sm transition hover:bg-brand-600 hover:text-white short:size-7"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CartSummary({ cartTotal, cartCount, onPay, busy }) {
  return (
    <div className="space-y-3 short:space-y-2">
      <div className="flex items-center justify-between text-sm text-slate-500 short:hidden">
        <span>{cartCount} item</span>
        <span>Subtotal {rupiah(cartTotal)}</span>
      </div>
      <div className="flex items-end justify-between">
        <span className="text-sm font-semibold text-slate-600">
          Total <span className="hidden short:inline">({cartCount} item)</span>
          <span className="short:hidden">bayar</span>
        </span>
        <span className="text-3xl font-extrabold tracking-tight text-slate-900 short:text-xl">{rupiah(cartTotal)}</span>
      </div>
      <button type="button" className="btn btn-primary btn-lg w-full short:rounded-xl short:py-2.5 short:text-sm" disabled={!cartCount || busy} onClick={onPay}>
        {busy ? <Spinner /> : <Wallet className="size-5" />} Bayar Sekarang <ArrowRight className="size-5" />
      </button>
    </div>
  );
}

/** Shown while at least one customer display is connected: the cart is mirrored there live. */
function LiveBadge() {
  return (
    <span
      title="Keranjang tampil langsung di layar pelanggan"
      className="pill gap-1 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200"
    >
      <MonitorSmartphone className="size-3.5" /> Live
    </span>
  );
}

function EmptyCart() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-6 py-10 text-center short:px-3 short:py-3">
      <div className="relative mb-4 short:mb-2">
        <div className="absolute inset-0 rounded-full bg-brand-200/50 blur-xl" />
        <div className="relative grid size-20 place-items-center rounded-3xl bg-linear-to-br from-brand-50 to-fuchsia-50 ring-1 ring-brand-100 short:size-12 short:rounded-2xl">
          <ShoppingBag className="size-9 text-brand-500 short:size-6" />
        </div>
      </div>
      <div className="font-bold text-slate-800 short:text-sm">Keranjang masih kosong</div>
      <p className="mt-1 text-sm text-slate-500 short:hidden">Ketuk produk di sebelah kiri untuk menambahkannya.</p>
    </div>
  );
}

function MethodDialog({ open, onClose, total, settings, onChoose, busy }) {
  const methods = [
    {
      id: 'qris',
      title: 'QRIS',
      desc: 'Pelanggan scan QR, nominal sudah terisi otomatis.',
      icon: QrCode,
      ok: settings.qris.configured,
      missing: 'QRIS belum diatur admin',
      gradient: 'from-brand-500 to-fuchsia-500',
    },
    {
      id: 'transfer',
      title: 'Transfer Bank',
      desc: settings.banks.length ? settings.banks.map((b) => b.bankName).join(' • ') : 'Transfer ke rekening toko.',
      icon: Landmark,
      ok: settings.banks.length > 0,
      missing: 'Rekening belum diatur admin',
      gradient: 'from-sky-500 to-indigo-600',
    },
  ];
  return (
    <Modal open={open} onClose={onClose} title="Pilih metode pembayaran" subtitle={`Total ${rupiah(total)}`} size="md">
      <div className="grid gap-3 pb-1 short:grid-cols-2">
        {methods.map(({ id, title, desc, icon: Icon, ok, missing, gradient }) => (
          <button
            key={id}
            type="button"
            disabled={!ok || Boolean(busy)}
            onClick={() => onChoose(id)}
            className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-300 hover:shadow-lg hover:shadow-brand-600/5 disabled:opacity-60 short:gap-3 short:p-3"
          >
            <span className={`grid size-14 shrink-0 place-items-center rounded-2xl bg-linear-to-br ${gradient} text-white shadow-lg short:size-11 short:rounded-xl`}>
              {busy === id ? <Spinner className="size-6" /> : <Icon className="size-7" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold text-slate-900">{title}</span>
              <span className={`block text-sm ${ok ? 'text-slate-500' : 'font-semibold text-amber-600'}`}>{ok ? desc : missing}</span>
            </span>
            <ChevronRight className="size-5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />
          </button>
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-slate-500 short:mt-2">Pembayaran langsung tampil di layar pelanggan dan semua perangkat kasir.</p>
    </Modal>
  );
}

export default function POSPage() {
  const { user } = useAuth();
  const { products, productsLoaded, cart, cartLines, cartTotal, cartCount, cartApi, settings, stores, activeStoreId, upsertTx, openTx, pending, displayCount } = useData();
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const searchRef = useRef(null);
  const shortScreen = useShortScreen();

  useEffect(() => {
    setQuery('');
    setCategory('');
    setSheetOpen(false);
    setMethodOpen(false);
  }, [activeStoreId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products]);
  const qtyById = useMemo(() => Object.fromEntries(cart.map((i) => [i.productId, i.qty])), [cart]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => (!category || p.category === category) && (!q || p.name.toLowerCase().includes(q)));
  }, [products, query, category]);

  const checkout = async (method) => {
    setBusy(method);
    try {
      const { transaction } = await api('/transactions', {
        method: 'POST',
        body: { method, items: cart.map(({ productId, qty }) => ({ productId, qty })) },
      });
      upsertTx(transaction);
      cartApi.clear();
      setMethodOpen(false);
      setSheetOpen(false);
      openTx(transaction.id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const startPay = () => {
    setSheetOpen(false);
    setMethodOpen(true);
  };

  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';

  return (
    <div className="wide:flex wide:h-dvh">
      <section className="min-w-0 flex-1 wide:overflow-y-auto">
        <div className="flex items-end justify-between gap-4 px-4 pt-4 md:px-6 md:pt-6 short:hidden">
          <div>
            <p className="text-sm text-slate-500">
              {formatDateLong(Date.now())}{stores.length > 1 && settings.store.name ? ` • ${settings.store.name}` : ''}
            </p>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
              {greeting}, {user.name.split(' ')[0]} <span className="inline-block origin-bottom-right animate-pop-in">👋</span>
            </h1>
          </div>
          {pending.length > 0 && (
            <Link to="/pembayaran" className="flex shrink-0 items-center gap-2 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-200">
              <span className="size-2 animate-pulse rounded-full bg-amber-500" />
              {pending.length} <span className="hidden sm:inline">menunggu konfirmasi</span>
            </Link>
          )}
        </div>
        <div className="sticky top-14 z-20 border-b border-slate-200/70 bg-slate-100/85 px-4 pt-3 pb-3 backdrop-blur-md wide:top-0 md:px-6 short:flex short:items-center short:gap-2 short:px-3 short:py-2">
          <div className="relative short:w-2/5 short:max-w-64 short:shrink-0">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-slate-400 short:left-3 short:size-4" />
            <input
              id="pos-search"
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={shortScreen ? 'Cari...' : 'Cari produk...'}
              aria-label="Cari produk"
              className="input h-12 rounded-2xl pr-10 pl-11 short:h-10 short:rounded-xl short:pr-8 short:pl-9"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Hapus pencarian">
                <X className="size-5" />
              </button>
            ) : (
              <kbd className="absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-slate-50 px-1.5 text-xs font-semibold text-slate-400 lg:block">/</kbd>
            )}
          </div>
          {categories.length > 0 && (
            <div className="scrollbar-none -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 md:-mx-6 md:px-6 short:mx-0 short:mt-0 short:min-w-0 short:flex-1 short:px-0">
              <button type="button" onClick={() => setCategory('')} className={`chip ${!category ? 'chip-on' : 'chip-off'}`}>
                Semua <span className="opacity-60">{products.length}</span>
              </button>
              {categories.map((c) => (
                <button key={c} type="button" onClick={() => setCategory(c === category ? '' : c)} className={`chip ${c === category ? 'chip-on' : 'chip-off'}`}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`p-4 md:p-6 short:p-3 ${cartCount ? 'pb-28 wide:pb-6 short:pb-3' : ''}`}>
          {!productsLoaded ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 sm:gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-slate-200/70" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={PackagePlus}
                title="Belum ada produk"
                description={user.role === 'admin' ? 'Tambahkan produk pertama Anda untuk mulai berjualan.' : 'Minta admin menambahkan produk terlebih dahulu.'}
                action={user.role === 'admin' && (
                  <button type="button" className="btn btn-primary" onClick={() => navigate('/produk')}>
                    <Plus className="size-4" /> Tambah Produk
                  </button>
                )}
              />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Search} title="Produk tidak ditemukan" description={`Tidak ada produk yang cocok dengan “${query}”.`} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 sm:gap-4 short:grid-cols-[repeat(auto-fill,minmax(124px,1fr))] short:gap-2.5">
              {filtered.map((p) => (
                <ProductCard key={p.id} product={p} qty={qtyById[p.id] || 0} onAdd={() => cartApi.add(p.id)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Cart panel: tablet & desktop */}
      <aside className="hidden w-[340px] shrink-0 flex-col border-l border-slate-200 bg-white wide:flex lg:w-[380px] xl:w-[400px] short:w-[clamp(232px,36vw,300px)] short:pr-[env(safe-area-inset-right)]">
        <div className="flex h-[76px] shrink-0 items-center justify-between border-b border-slate-100 px-5 short:h-12 short:px-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-slate-900 short:text-base">
              Pesanan {displayCount > 0 && <LiveBadge />}
            </h2>
            <p className="text-xs text-slate-500 short:hidden">{cartCount ? `${cartCount} item di keranjang` : 'Belum ada item'}</p>
          </div>
          {cartCount > 0 && (
            <button type="button" className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={cartApi.clear}>
              <Trash2 className="size-4" /> Kosongkan
            </button>
          )}
        </div>
        {cartLines.length ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 short:px-3">
            <CartLines lines={cartLines} cartApi={cartApi} />
          </div>
        ) : (
          <EmptyCart />
        )}
        <div className="shrink-0 border-t border-slate-100 bg-slate-50/60 p-5 short:p-3">
          <CartSummary cartTotal={cartTotal} cartCount={cartCount} onPay={startPay} busy={Boolean(busy)} />
        </div>
      </aside>

      {/* Floating cart bar: phone */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 p-3 wide:hidden">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex w-full animate-pop-in items-center gap-3 rounded-2xl bg-linear-to-br from-brand-600 to-brand-800 p-3 pl-4 text-left text-white shadow-2xl shadow-brand-900/40"
          >
            <span className="relative">
              <ShoppingBag className="size-6" />
              <span className="absolute -top-2 -right-2.5 grid min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] leading-5 font-extrabold text-brand-700">
                {cartCount}
              </span>
            </span>
            <span className="ml-2 min-w-0 flex-1">
              <span className="block text-xs text-brand-100">Total</span>
              <span className="block text-lg font-extrabold">{rupiah(cartTotal)}</span>
            </span>
            <span className="flex items-center gap-1 rounded-xl bg-white/15 px-3 py-2 text-sm font-bold">
              Lihat <ArrowRight className="size-4" />
            </span>
          </button>
        </div>
      )}

      <Modal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Pesanan"
        subtitle={`${cartCount} item${displayCount > 0 ? ' • tampil di layar pelanggan' : ''}`}
        footer={<CartSummary cartTotal={cartTotal} cartCount={cartCount} onPay={startPay} busy={Boolean(busy)} />}
      >
        {cartLines.length ? <CartLines lines={cartLines} cartApi={cartApi} /> : <EmptyCart />}
        {cartLines.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm mt-1 text-rose-600" onClick={cartApi.clear}>
            <Trash2 className="size-4" /> Kosongkan keranjang
          </button>
        )}
      </Modal>

      <MethodDialog
        open={methodOpen}
        onClose={() => !busy && setMethodOpen(false)}
        total={cartTotal}
        settings={settings}
        onChoose={checkout}
        busy={busy}
      />
    </div>
  );
}
