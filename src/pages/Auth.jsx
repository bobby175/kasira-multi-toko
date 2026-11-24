import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Landmark, MonitorSmartphone, QrCode, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../state/auth.jsx';
import { Logo, Spinner } from '../components/ui.jsx';

function Hero() {
  const points = [
    { icon: QrCode, title: 'QRIS otomatis bernominal', desc: 'Pelanggan cukup scan, tanpa ketik nominal.' },
    { icon: MonitorSmartphone, title: 'Layar ganda real-time', desc: 'HP, tablet, dan PC tersinkron seketika.' },
    { icon: ShieldCheck, title: 'Konfirmasi oleh karyawan', desc: 'Pembayaran disetujui manual & aman.' },
    { icon: Landmark, title: 'Transfer bank', desc: 'Tampilkan rekening toko dengan rapi.' },
  ];
  return (
    <div className="relative hidden overflow-hidden bg-brand-950 p-12 text-white lg:flex lg:flex-col">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-32 size-[520px] animate-float rounded-full bg-brand-600/35 blur-[110px]" />
        <div className="absolute -right-40 -bottom-40 size-[480px] animate-float rounded-full bg-fuchsia-600/25 blur-[110px] [animation-delay:-6s]" />
      </div>
      <Logo dark className="relative" />
      <div className="relative mt-auto mb-auto max-w-lg">
        <h2 className="text-5xl leading-[1.05] font-extrabold tracking-tight">
          Kasir modern,
          <br />
          <span className="bg-linear-to-r from-brand-300 via-fuchsia-300 to-amber-200 bg-clip-text text-transparent">bayar tanpa ribet.</span>
        </h2>
        <div className="mt-10 grid gap-4">
          {points.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-center gap-4 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 backdrop-blur">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-linear-to-br from-brand-500 to-fuchsia-500 shadow-lg shadow-brand-900/50">
                <Icon className="size-5" />
              </div>
              <div>
                <div className="font-bold">{title}</div>
                <div className="text-sm text-slate-400">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="relative text-xs text-slate-500">© {new Date().getFullYear()} Kasira</div>
    </div>
  );
}

function AuthLayout({ children, hideLogoOnShort = false }) {
  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[1.1fr_1fr]">
      <Hero />
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12 short:py-4">
        <div className="mx-auto w-full max-w-sm short:max-w-xl">
          <Logo className={`mb-10 lg:hidden short:mb-4 ${hideLogoOnShort ? 'short:hidden' : ''}`} />
          {children}
        </div>
      </div>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? 'text' : 'password'} className="input pr-11" value={value} onChange={onChange} required minLength={6} autoComplete={autoComplete} />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label={show ? 'Sembunyikan' : 'Tampilkan'}>
        {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  );
}

export function LoginPage() {
  const { setUser, storeName, sessionExpired, needsSetup, loginNotice, showSetup } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(sessionExpired ? 'Sesi Anda berakhir. Silakan masuk kembali.' : '');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api('/auth/login', { method: 'POST', body: { username, password } });
      setUser(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 short:text-2xl">Masuk</h1>
      <p className="mt-1 text-slate-500">
        {needsSetup ? 'Masuk untuk mulai berjualan.' : storeName ? `Kasir ${storeName}` : 'Masuk untuk mulai berjualan.'}
      </p>
      {loginNotice && !error && (
        <div className="mt-6 rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-800 ring-1 ring-brand-200 short:mt-3">{loginNotice}</div>
      )}
      <form onSubmit={submit} className="mt-8 space-y-4 short:mt-4 short:space-y-3">
        <div className="space-y-4 short:grid short:grid-cols-2 short:gap-3 short:space-y-0">
          <div>
            <label className="label" htmlFor="l-user">Username</label>
            <input id="l-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus autoCapitalize="none" autoComplete="username" />
          </div>
          <div>
            <label className="label" htmlFor="l-pass">Kata sandi</label>
            <PasswordInput id="l-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
        </div>
        {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 ring-1 ring-rose-200">{error}</div>}
        <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy}>
          {busy ? <Spinner /> : null} Masuk <ArrowRight className="size-5" />
        </button>
      </form>
      {needsSetup && (
        <p className="mt-6 text-center text-sm text-slate-500 short:mt-3">
          Belum ada akun di server ini. Pastikan alamat server benar, atau{' '}
          <button type="button" onClick={showSetup} className="font-semibold text-brand-600 hover:text-brand-700 hover:underline">
            lakukan setup awal
          </button>
          .
        </p>
      )}
      <a href="/display" className="mt-8 block text-center text-sm font-semibold text-brand-600 hover:text-brand-700 short:mt-4">
        Jadikan perangkat ini Layar Pelanggan →
      </a>
    </AuthLayout>
  );
}

export function SetupPage() {
  const { setUser, showLogin } = useAuth();
  const [form, setForm] = useState({ storeName: '', name: '', username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api('/setup', { method: 'POST', body: form });
      setUser(user);
    } catch (err) {
      // Setup was already completed (e.g. from another device): go to the login form instead.
      if (err.status === 409) showLogin('Toko ini sudah pernah di-setup. Silakan masuk dengan akun Anda.');
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout hideLogoOnShort>
      <span className="pill mb-4 bg-brand-50 text-brand-700 short:mb-2">Setup awal</span>
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 short:text-2xl">Selamat datang di Kasira</h1>
      <p className="mt-1 text-slate-500 short:hidden">Buat toko dan akun admin (pemilik) Anda.</p>
      <form onSubmit={submit} className="mt-8 space-y-4 short:mt-4 short:space-y-3">
        <div className="space-y-4 short:grid short:grid-cols-2 short:gap-3 short:space-y-0">
          <div>
            <label className="label" htmlFor="st-store">Nama toko</label>
            <input id="st-store" className="input" value={form.storeName} onChange={set('storeName')} required maxLength={60} autoFocus placeholder="contoh: Kopi Senja" />
          </div>
          <div>
            <label className="label" htmlFor="st-name">Nama Anda</label>
            <input id="st-name" className="input" value={form.name} onChange={set('name')} required maxLength={60} />
          </div>
          <div>
            <label className="label" htmlFor="st-user">Username admin</label>
            <input id="st-user" className="input" value={form.username} onChange={set('username')} required maxLength={32} autoCapitalize="none" autoComplete="username" />
          </div>
          <div>
            <label className="label" htmlFor="st-pass">Kata sandi <span className="font-normal text-slate-400">(min. 6)</span></label>
            <PasswordInput id="st-pass" value={form.password} onChange={set('password')} autoComplete="new-password" />
          </div>
        </div>
        {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 ring-1 ring-rose-200">{error}</div>}
        <button type="submit" className="btn btn-primary btn-lg w-full short:py-3" disabled={busy}>
          {busy ? <Spinner /> : null} Mulai <ArrowRight className="size-5" />
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500 short:mt-4">
        Sudah pernah setup?{' '}
        <button type="button" onClick={() => showLogin()} className="font-semibold text-brand-600 hover:text-brand-700 hover:underline">
          Masuk
        </button>
      </p>
    </AuthLayout>
  );
}
