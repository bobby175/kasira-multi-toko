import { useState } from 'react';
import { History, LayoutGrid, LogOut, Minimize, MonitorSmartphone, Package, Settings, Smartphone, Wallet } from 'lucide-react';
import { Link, usePathname } from '../lib/router.jsx';
import { ROLE_LABEL } from '../lib/format.js';
import { canLockLandscape, enterLandscape, exitFullscreen, useIsFullscreen } from '../lib/screen.js';
import { useAuth } from '../state/auth.jsx';
import { useData } from '../state/data.jsx';
import { DisplayDialog } from './DisplayDialog.jsx';
import { Avatar, Logo, LogoMark, useConfirm } from './ui.jsx';

export function useNavItems() {
  const { user } = useAuth();
  const { pending } = useData();
  const items = [
    { to: '/', label: 'Kasir', icon: LayoutGrid },
    { to: '/pembayaran', label: 'Pembayaran', icon: Wallet, badge: pending.length },
    { to: '/riwayat', label: 'Riwayat', icon: History },
  ];
  if (user.role === 'admin') {
    items.push({ to: '/produk', label: 'Produk', icon: Package });
    items.push({ to: '/pengaturan', label: 'Pengaturan', icon: Settings });
  }
  return items;
}

function ConnectionDot({ connected }) {
  return (
    <span className="flex items-center" title={connected ? 'Real-time aktif' : 'Menyambung ulang...'}>
      <span className={`size-2 rounded-full ${connected ? 'bg-emerald-400 shadow-[0_0_0_3px] shadow-emerald-400/25' : 'animate-pulse bg-amber-400'}`} />
    </span>
  );
}

function Badge({ count, className = '' }) {
  if (!count) return null;
  return (
    <span className={`grid min-w-5 place-items-center rounded-full bg-rose-500 px-1.5 text-[11px] leading-5 font-bold text-white ring-2 ring-slate-950 ${className}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

function useLogout() {
  const { logout, user } = useAuth();
  const confirm = useConfirm();
  return async () => {
    const ok = await confirm({
      title: 'Keluar dari Kasira?',
      message: `Anda masuk sebagai ${user.name} (${ROLE_LABEL[user.role]}).`,
      confirmLabel: 'Keluar',
      tone: 'danger',
      icon: LogOut,
    });
    if (ok) logout();
  };
}

/** Phone-only button: fullscreen + rotate to landscape (Android Chrome). */
function LandscapeToggle({ className = '', iconClass = 'size-5' }) {
  const fullscreen = useIsFullscreen();
  if (!canLockLandscape()) return null;
  return (
    <button
      type="button"
      onClick={() => (fullscreen ? exitFullscreen() : enterLandscape())}
      className={className}
      aria-label={fullscreen ? 'Keluar layar penuh' : 'Mode landscape layar penuh'}
      title={fullscreen ? 'Keluar layar penuh' : 'Mode landscape layar penuh'}
    >
      {fullscreen ? <Minimize className={iconClass} /> : <Smartphone className={`${iconClass} rotate-90`} />}
    </button>
  );
}

function Sidebar({ onOpenDisplay }) {
  const path = usePathname();
  const items = useNavItems();
  const { user } = useAuth();
  const { connected } = useData();
  const handleLogout = useLogout();

  return (
    <aside className="sticky top-0 hidden h-dvh w-[84px] shrink-0 flex-col bg-brand-950 text-slate-400 wide:flex xl:w-64 short:w-[calc(64px+env(safe-area-inset-left))] short:pl-[env(safe-area-inset-left)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-20 size-64 rounded-full bg-brand-600/25 blur-3xl" />
        <div className="absolute bottom-0 -right-24 size-56 rounded-full bg-fuchsia-600/10 blur-3xl" />
      </div>
      <div className="relative flex h-20 shrink-0 items-center justify-center px-5 xl:justify-start short:h-14 short:justify-center short:px-0">
        <span className="relative xl:hidden short:block">
          <LogoMark className="size-10 short:size-9" />
          <span className="absolute -right-1 -bottom-1 hidden rounded-full bg-brand-950 p-[3px] short:block">
            <ConnectionDot connected={connected} />
          </span>
        </span>
        <Logo dark className="hidden xl:flex short:hidden" />
      </div>
      <nav className="scrollbar-none relative mt-2 flex min-h-0 flex-1 flex-col gap-1.5 px-3 short:mt-0 short:gap-1 short:overflow-y-auto short:px-2">
        {items.map(({ to, label, icon: Icon, badge }) => {
          const active = to === '/' ? path === '/' : path.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              title={label}
              className={`group relative flex shrink-0 items-center justify-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition xl:justify-start short:justify-center short:rounded-xl short:py-2.5 ${
                active ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              {active && <span className="absolute top-1/2 left-0 h-6 w-1 -translate-x-3 -translate-y-1/2 rounded-r-full bg-linear-to-b from-brand-400 to-fuchsia-500 short:-translate-x-2" />}
              <Icon className={`size-[22px] shrink-0 short:size-5 ${active ? 'text-brand-300' : ''}`} />
              <span className="hidden xl:inline short:hidden">{label}</span>
              <Badge count={badge} className="absolute top-1.5 right-2 xl:static xl:ml-auto short:absolute short:top-0.5 short:right-0.5" />
            </Link>
          );
        })}
      </nav>
      <div className="relative shrink-0 space-y-2 p-3 short:space-y-1 short:p-2">
        <LandscapeToggle className="hidden w-full justify-center rounded-xl p-2.5 text-slate-300 hover:bg-white/10 hover:text-white short:flex" />
        <button
          type="button"
          onClick={onOpenDisplay}
          title="Layar Pelanggan"
          className="flex w-full items-center justify-center gap-3 rounded-2xl bg-linear-to-br from-brand-500/20 to-fuchsia-500/10 px-3 py-3 text-sm font-semibold text-brand-100 ring-1 ring-white/10 transition hover:from-brand-500/30 xl:justify-start short:justify-center short:rounded-xl short:py-2.5"
        >
          <MonitorSmartphone className="size-[22px] shrink-0 short:size-5" />
          <span className="hidden xl:inline short:hidden">Layar Pelanggan</span>
        </button>
        <div className="flex items-center justify-center gap-3 rounded-2xl p-2 xl:justify-start xl:bg-white/5 short:hidden">
          <div className="relative">
            <Avatar name={user.name} />
            <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-brand-950 p-[3px]">
              <ConnectionDot connected={connected} />
            </span>
          </div>
          <div className="hidden min-w-0 flex-1 xl:block">
            <div className="truncate text-sm font-bold text-white">{user.name}</div>
            <div className="text-xs">{ROLE_LABEL[user.role]}</div>
          </div>
          <button type="button" onClick={handleLogout} className="hidden rounded-xl p-2 hover:bg-white/10 hover:text-white xl:block" aria-label="Keluar" title="Keluar">
            <LogOut className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full justify-center rounded-xl p-2 hover:bg-white/10 hover:text-white xl:hidden short:flex short:p-2.5"
          aria-label="Keluar"
          title={`Keluar (${user.name})`}
        >
          <LogOut className="size-5" />
        </button>
      </div>
    </aside>
  );
}

function MobileTopBar({ onOpenDisplay }) {
  const { user } = useAuth();
  const { connected, settings } = useData();
  const handleLogout = useLogout();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-white/5 bg-brand-950/95 px-4 text-white backdrop-blur wide:hidden">
      <LogoMark className="size-8" />
      <div className="ml-1 min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-bold">{settings.store.name || 'Kasira'}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <ConnectionDot connected={connected} /> <span className="truncate">{user.name} • {ROLE_LABEL[user.role]}</span>
        </div>
      </div>
      <LandscapeToggle className="rounded-xl p-2 text-slate-300 hover:bg-white/10" />
      <button type="button" onClick={onOpenDisplay} className="rounded-xl p-2 text-slate-300 hover:bg-white/10" aria-label="Layar Pelanggan">
        <MonitorSmartphone className="size-5" />
      </button>
      <button type="button" onClick={handleLogout} className="rounded-xl p-2 text-slate-300 hover:bg-white/10" aria-label="Keluar">
        <LogOut className="size-5" />
      </button>
    </header>
  );
}

function MobileBottomNav() {
  const path = usePathname();
  const items = useNavItems();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-safe backdrop-blur wide:hidden">
      <div className="flex h-16 items-stretch">
        {items.map(({ to, label, icon: Icon, badge }) => {
          const active = to === '/' ? path === '/' : path.startsWith(to);
          return (
            <Link key={to} to={to} className={`relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${active ? 'text-brand-600' : 'text-slate-500'}`}>
              <span className={`grid h-7 w-12 place-items-center rounded-full transition ${active ? 'bg-brand-50' : ''}`}>
                <Icon className="size-5" />
              </span>
              {label}
              {badge > 0 && (
                <span className="absolute top-1.5 left-1/2 ml-2 grid min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] leading-[18px] font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function Shell({ children }) {
  const { user } = useAuth();
  const [displayOpen, setDisplayOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <Sidebar onOpenDisplay={() => setDisplayOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar onOpenDisplay={() => setDisplayOpen(true)} />
        <main className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] wide:pb-0">{children}</main>
        <MobileBottomNav />
      </div>
      <DisplayDialog open={displayOpen} onClose={() => setDisplayOpen(false)} isAdmin={user.role === 'admin'} />
    </div>
  );
}

/** Standard page header used by non-POS pages. */
export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between short:mb-4 short:gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl short:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
