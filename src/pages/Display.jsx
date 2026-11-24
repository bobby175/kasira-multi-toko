import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Expand, KeyRound, Loader2, ShoppingBag, WifiOff, XCircle } from 'lucide-react';
import { rupiah } from '../lib/format.js';
import { enterLandscape, isPhone, useIsFullscreen } from '../lib/screen.js';
import { playChime, unlockAudioOnFirstGesture } from '../lib/sound.js';
import { PaymentInstructions } from '../components/PaymentInstructions.jsx';
import { SuccessBadge } from '../components/PaymentDialog.jsx';
import { LogoMark } from '../components/ui.jsx';

const KEY_STORAGE = 'kasira_display_key';

function readInitialKey() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('key');
  if (fromUrl) {
    localStorage.setItem(KEY_STORAGE, fromUrl);
    window.history.replaceState(null, '', '/display'); // don't leave the key in the address bar
    return fromUrl;
  }
  return localStorage.getItem(KEY_STORAGE);
}

function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -top-1/4 -left-1/4 size-[70vmax] animate-float rounded-full bg-brand-600/25 blur-[120px]" />
      <div className="absolute -right-1/4 -bottom-1/3 size-[60vmax] animate-float rounded-full bg-fuchsia-600/20 blur-[120px] [animation-delay:-5s]" />
      <div className="absolute top-1/3 left-1/2 size-[30vmax] animate-float rounded-full bg-sky-500/10 blur-[100px] [animation-delay:-9s]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,rgba(15,13,36,0.6)_100%)]" />
    </div>
  );
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 15);
    return () => clearInterval(t);
  }, []);
  return now;
}

function PairForm({ error, onSubmit }) {
  const [value, setValue] = useState('');
  return (
    <div className="relative z-10 flex min-h-dvh items-center justify-center p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(value);
        }}
        className="w-full max-w-sm rounded-[28px] bg-white/[0.06] p-7 text-center ring-1 ring-white/10 backdrop-blur-xl short:p-5"
      >
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-brand-500/20 text-brand-200 short:mb-3 short:size-10">
          <KeyRound className="size-7 short:size-5" />
        </div>
        <h1 className="text-xl font-extrabold text-white">Pasangkan Layar Pelanggan</h1>
        <p className="mt-2 text-sm text-slate-400">
          Buka Kasira di perangkat kasir → menu <b className="text-slate-200">Layar Pelanggan</b> untuk melihat kode.
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          maxLength={9}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          className="mt-6 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-center font-mono text-2xl font-bold tracking-[0.3em] text-white placeholder:text-slate-600 focus:border-brand-400 focus:outline-hidden short:mt-4 short:py-3"
        />
        {error && <p className="mt-3 text-sm font-semibold text-rose-300">{error}</p>}
        <button type="submit" disabled={value.replace(/[^A-Z0-9]/g, '').length < 8} className="btn btn-primary btn-lg mt-5 w-full short:mt-4 short:py-3">
          Hubungkan
        </button>
      </form>
    </div>
  );
}

function IdleView({ store }) {
  const now = useClock();
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <LogoMark className="mb-8 size-20 drop-shadow-[0_10px_40px_rgba(139,92,246,0.5)] short:mb-3 short:size-12" />
      <p className="text-lg font-medium text-brand-200/80 short:text-sm">Selamat datang di</p>
      <h1 className="mt-2 bg-linear-to-br from-white via-white to-brand-200 bg-clip-text text-5xl font-extrabold tracking-tight text-transparent sm:text-7xl short:mt-1 short:text-4xl">
        {store.name}
      </h1>
      <div className="mt-10 text-6xl font-extralight tabular-nums text-white/90 sm:text-8xl short:mt-4 short:text-6xl">
        {now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="mt-2 text-slate-400 short:mt-1 short:text-sm">
        {now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </div>
      <div className="mt-12 flex flex-wrap items-center justify-center gap-2 text-xs font-bold tracking-wider text-slate-400 short:mt-5">
        <span className="rounded-full bg-white/5 px-3 py-1.5 ring-1 ring-white/10">QRIS</span>
        <span className="rounded-full bg-white/5 px-3 py-1.5 ring-1 ring-white/10">TRANSFER BANK</span>
      </div>
    </div>
  );
}

function PaymentView({ state }) {
  const tx = state.transaction;
  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-5 py-6 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:px-10 short:grid-cols-[minmax(0,1fr)_auto] short:gap-6 short:px-0 short:py-2">
      <div className="order-2 lg:order-1 short:order-1">
        <div className="mb-4 flex items-center gap-3 short:mb-1.5">
          <span className="relative flex size-3">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex size-3 rounded-full bg-amber-400" />
          </span>
          <span className="text-sm font-bold tracking-wide text-amber-200">Menunggu pembayaran</span>
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl short:text-2xl">
          {tx.method === 'qris' ? 'Silakan scan QRIS' : 'Silakan transfer'}
        </h2>
        <p className="mt-2 text-slate-400 short:hidden">
          Pembayaran akan dikonfirmasi oleh kasir setelah dana diterima. Mohon tunggu sebentar.
        </p>
        <div className="mt-6 rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur short:mt-3 short:rounded-2xl short:p-4">
          <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 short:mb-2">
            <span className="flex items-center gap-2"><ShoppingBag className="size-4" /> Pesanan Anda</span>
            <span>{tx.code}</span>
          </div>
          <ul className="max-h-[32vh] space-y-2 overflow-y-auto pr-1 short:max-h-[30dvh] short:space-y-1 short:text-sm">
            {tx.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-4 text-slate-200">
                <span className="min-w-0"><span className="font-bold text-white">{item.qty}×</span> {item.name}</span>
                <span className="shrink-0 tabular-nums">{rupiah(item.subtotal)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-end justify-between border-t border-dashed border-white/15 pt-4 short:mt-3 short:pt-3">
            <span className="font-semibold text-slate-300">Total</span>
            <span className="text-3xl font-extrabold text-white short:text-[1.75rem]">{rupiah(tx.total)}</span>
          </div>
        </div>
      </div>
      <div className="order-1 lg:order-2 short:order-2">
        <PaymentInstructions
          method={tx.method}
          total={tx.total}
          qrisPayload={tx.qrisPayload}
          qris={state.qris}
          banks={state.banks}
          tone="dark"
          size="lg"
        />
      </div>
    </div>
  );
}

/** Live view of the order while the cashier is ringing it up. */
function CartView({ state }) {
  const { cart } = state;
  const listRef = useRef(null);

  // Bring the item that was just added into view.
  useEffect(() => {
    if (!cart.lastChangedId) return;
    listRef.current
      ?.querySelector(`[data-pid="${cart.lastChangedId}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cart.rev, cart.lastChangedId]);

  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-6 px-5 py-6 lg:grid-cols-[1.25fr_1fr] lg:gap-12 lg:px-10 short:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] short:gap-5 short:px-0 short:py-2">
      <section className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur short:rounded-2xl short:p-3">
        <div className="mb-2 flex items-center justify-between px-3 text-xs font-bold uppercase tracking-wider text-slate-400 short:mb-1">
          <span className="flex items-center gap-2"><ShoppingBag className="size-4" /> Pesanan Anda</span>
          <span>{cart.itemCount} item</span>
        </div>
        <ul ref={listRef} className="max-h-[48dvh] space-y-0.5 overflow-y-auto pr-1 lg:max-h-[58dvh] short:max-h-[calc(100dvh-7.5rem)]">
          {cart.items.map((item) => (
            <li key={item.productId} data-pid={item.productId} className="relative flex items-center justify-between gap-4 rounded-xl px-3 py-2.5 short:py-1.5">
              {item.productId === cart.lastChangedId && (
                <span key={cart.rev} className="pointer-events-none absolute inset-0 animate-flash rounded-xl bg-brand-400/25 ring-1 ring-brand-300/40" />
              )}
              <div className="relative min-w-0">
                <div className="truncate font-semibold text-white">{item.name}</div>
                <div className="text-sm text-slate-400 short:text-xs">
                  {item.qty} × {rupiah(item.price)}
                </div>
              </div>
              <div className="relative shrink-0 text-lg font-bold tabular-nums text-white short:text-base">{rupiah(item.subtotal)}</div>
            </li>
          ))}
        </ul>
      </section>
      <section className="text-center lg:text-left short:text-left">
        <div className="flex items-center justify-center gap-2.5 lg:justify-start short:justify-start">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-300 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-brand-300" />
          </span>
          <span className="text-sm font-bold tracking-wide text-brand-200">Kasir sedang mencatat pesanan</span>
        </div>
        <div className="mt-6 text-sm font-semibold uppercase tracking-wider text-slate-400 short:mt-3 short:text-xs">Total belanja</div>
        <div key={cart.rev} className="animate-pop-in text-6xl font-extrabold tracking-tight text-white tabular-nums sm:text-7xl short:text-4xl">
          {rupiah(cart.total)}
        </div>
        <div className="mt-2 text-slate-400 short:mt-1 short:text-sm">
          {cart.itemCount} item • dilayani oleh {cart.cashier}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-xs font-bold tracking-wider text-slate-400 lg:justify-start short:mt-4 short:justify-start">
          <span className="mr-1 font-semibold tracking-normal normal-case">Bayar dengan</span>
          <span className="rounded-full bg-white/5 px-3 py-1.5 ring-1 ring-white/10">QRIS</span>
          <span className="rounded-full bg-white/5 px-3 py-1.5 ring-1 ring-white/10">TRANSFER BANK</span>
        </div>
      </section>
    </div>
  );
}

function SuccessView({ state }) {
  const tx = state.transaction;
  return (
    <div className="flex flex-1 animate-pop-in flex-col items-center justify-center px-6 text-center">
      <SuccessBadge className="size-36 sm:size-44 short:size-24" />
      <h1 className="mt-10 text-4xl font-extrabold tracking-tight text-white sm:text-6xl short:mt-5 short:text-4xl">Pembayaran Berhasil</h1>
      <div className="mt-4 text-3xl font-bold text-emerald-300 sm:text-4xl short:mt-2 short:text-2xl">{rupiah(tx.total)}</div>
      <p className="mt-6 text-lg text-slate-300 short:mt-3 short:text-base">Terima kasih telah berbelanja di {state.store.name} 💜</p>
    </div>
  );
}

function CancelledView() {
  return (
    <div className="flex flex-1 animate-pop-in flex-col items-center justify-center px-6 text-center">
      <XCircle className="size-24 text-slate-500 short:size-16" />
      <h1 className="mt-6 text-3xl font-extrabold text-white short:mt-4">Transaksi dibatalkan</h1>
      <p className="mt-2 text-slate-400">Silakan hubungi kasir bila ada pertanyaan.</p>
    </div>
  );
}

export default function DisplayPage() {
  const [key, setKey] = useState(readInitialKey);
  const [state, setState] = useState(null);
  const [status, setStatus] = useState(key ? 'connecting' : 'unpaired'); // connecting | online | offline | unpaired
  const [error, setError] = useState('');
  const lastPhase = useRef(null);
  const fullscreen = useIsFullscreen();

  useEffect(() => {
    document.title = 'Layar Pelanggan • Kasira';
    unlockAudioOnFirstGesture();
    // keep the screen awake when supported (needs HTTPS on most browsers)
    let lock = null;
    const requestLock = () => navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    requestLock();
    const onVisible = () => document.visibilityState === 'visible' && requestLock();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release?.().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!key) return undefined;
    setStatus('connecting');
    const socket = io({ auth: { displayKey: key } });
    socket.on('connect', () => {
      setStatus('online');
      setError('');
    });
    socket.on('display:state', (next) => {
      if (next.phase === 'success' && lastPhase.current !== 'success') playChime('success');
      lastPhase.current = next.phase;
      setState(next);
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // key was regenerated by admin
        localStorage.removeItem(KEY_STORAGE);
        setKey(null);
        setStatus('unpaired');
        setError('Kode layar telah diganti. Masukkan kode yang baru.');
      } else {
        setStatus('offline');
      }
    });
    socket.on('connect_error', (err) => {
      if (err.message === 'INVALID_DISPLAY_KEY') {
        socket.close();
        localStorage.removeItem(KEY_STORAGE);
        setKey(null);
        setStatus('unpaired');
        setError('Kode layar salah atau sudah diganti.');
      } else if (err.message === 'RATE_LIMITED') {
        socket.close();
        setStatus('unpaired');
        setError('Terlalu banyak percobaan. Tunggu beberapa menit.');
      } else {
        setStatus('offline');
      }
    });
    return () => socket.close();
  }, [key]);

  const pair = (value) => {
    const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    localStorage.setItem(KEY_STORAGE, normalized);
    setError('');
    setKey(normalized);
  };

  // On phones, going fullscreen also rotates to landscape (Android Chrome).
  const goFullscreen = () => enterLandscape({ lock: isPhone() });

  return (
    <div className="relative min-h-dvh overflow-hidden bg-brand-950 text-white select-none">
      <Backdrop />
      {status === 'unpaired' || !key ? (
        <PairForm error={error} onSubmit={pair} />
      ) : !state ? (
        <div className="relative z-10 flex min-h-dvh items-center justify-center text-slate-400">
          <Loader2 className="size-8 animate-spin" />
        </div>
      ) : (
        <div className="relative z-10 flex min-h-dvh flex-col short:px-safe">
          <header className="flex items-center justify-between px-5 pt-5 lg:px-10 lg:pt-8 short:px-0 short:pt-2.5">
            <div className="flex items-center gap-3 short:gap-2">
              <LogoMark className="size-9 short:size-7" />
              <span className="text-lg font-bold text-white/90 short:text-base">{state.store.name}</span>
            </div>
            <div className="flex items-center gap-2">
              {status !== 'online' && (
                <span className="flex items-center gap-2 rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-200 ring-1 ring-amber-400/30">
                  <WifiOff className="size-3.5" /> Menyambung ulang...
                </span>
              )}
              {document.fullscreenEnabled && !fullscreen && (
                <button type="button" onClick={goFullscreen} className="rounded-full p-2 text-white/30 transition hover:bg-white/10 hover:text-white" aria-label="Layar penuh">
                  <Expand className="size-5" />
                </button>
              )}
            </div>
          </header>
          {state.phase === 'cart' && state.cart ? (
            <CartView state={state} />
          ) : state.phase === 'payment' && state.transaction ? (
            <PaymentView state={state} />
          ) : state.phase === 'success' && state.transaction ? (
            <SuccessView state={state} />
          ) : state.phase === 'cancelled' ? (
            <CancelledView />
          ) : (
            <IdleView store={state.store} />
          )}
          <footer className="px-6 pb-5 text-center text-[11px] font-medium tracking-wider text-white/25 short:hidden">Didukung oleh Kasira</footer>
        </div>
      )}
    </div>
  );
}
