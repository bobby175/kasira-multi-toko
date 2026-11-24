import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle, QrCode, Landmark } from 'lucide-react';
import { STATUS_LABEL, initials, tileGradient } from '../lib/format.js';

// ---------- Brand ----------

export function LogoMark({ className = 'size-10' }) {
  // Each instance needs its own gradient id: a shared id would point at the first logo on the page,
  // which may be inside a hidden panel (e.g. the desktop sidebar on phones) and then renders nothing.
  const gradientId = `kasira-g-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset=".55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <path d="M22 16v32M22 33l17-17M27 29l14 19" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="46" cy="20" r="4" fill="#a7f3d0" />
    </svg>
  );
}

export function Logo({ dark = false, className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark className="size-9 shrink-0" />
      <div className="leading-none">
        <div className={`text-lg font-extrabold tracking-tight ${dark ? 'text-white' : 'text-slate-900'}`}>Kasira</div>
        <div className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          Kasir Modern
        </div>
      </div>
    </div>
  );
}

// ---------- Small pieces ----------

export const Spinner = ({ className = 'size-5' }) => <Loader2 className={`animate-spin ${className}`} />;

export function FullScreenLoader({ label = 'Memuat...' }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-brand-950 text-slate-300">
      <LogoMark className="size-14 animate-pulse" />
      <div className="text-sm font-medium">{label}</div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid size-16 place-items-center rounded-2xl bg-linear-to-br from-brand-50 to-fuchsia-50 text-brand-500 ring-1 ring-brand-100">
        <Icon className="size-7" />
      </div>
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-200 text-slate-600',
};

export function StatusPill({ status }) {
  return (
    <span className={`pill ${STATUS_STYLE[status]}`}>
      <span className={`size-1.5 rounded-full bg-current ${status === 'pending' ? 'animate-pulse' : ''}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function MethodBadge({ method, className = '' }) {
  const isQris = method === 'qris';
  const Icon = isQris ? QrCode : Landmark;
  return (
    <span className={`pill ${isQris ? 'bg-brand-50 text-brand-700' : 'bg-sky-50 text-sky-700'} ${className}`}>
      <Icon className="size-3.5" />
      {isQris ? 'QRIS' : 'Transfer'}
    </span>
  );
}

export function ProductThumb({ product, className = '' }) {
  if (product.image) {
    return <img src={product.image} alt="" loading="lazy" className={`object-cover ${className}`} />;
  }
  return (
    <div className={`grid place-items-center bg-linear-to-br ${tileGradient(product.name)} ${className}`}>
      <span className="text-[1.6em] font-extrabold text-white/95 drop-shadow-sm">{initials(product.name)}</span>
    </div>
  );
}

export function Avatar({ name, className = 'size-9 text-sm' }) {
  return (
    <div className={`grid shrink-0 place-items-center rounded-full bg-linear-to-br ${tileGradient(name)} font-bold text-white ${className}`}>
      {initials(name)}
    </div>
  );
}

/** Renders a QR code for `value` as an image. */
export function QRImage({ value, className = '', size = 640, dark = '#0f0d24' }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!value) {
      setSrc(null);
      return undefined;
    }
    QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: size, color: { dark, light: '#ffffff' } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size, dark]);
  if (!src) return <div className={`animate-pulse rounded-xl bg-slate-100 ${className}`} />;
  return <img src={src} alt="Kode QR" className={`[image-rendering:pixelated] ${className}`} draggable={false} />;
}

// ---------- Modal / bottom sheet ----------

let scrollLocks = 0;
function lockScroll() {
  if (scrollLocks++ === 0) document.documentElement.style.overflow = 'hidden';
}
function unlockScroll() {
  if (--scrollLocks <= 0) {
    scrollLocks = 0;
    document.documentElement.style.overflow = '';
  }
}

const MODAL_SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', dismissable = true, bodyClassName = '' }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    lockScroll();
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      unlockScroll();
    };
  }, [open, dismissable]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6 short:items-center short:p-2 short:px-[max(0.5rem,env(safe-area-inset-left))]">
      <div
        className="absolute inset-0 animate-fade-in bg-slate-950/55 backdrop-blur-[3px]"
        onClick={dismissable ? onClose : undefined}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        className={`relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl
          animate-sheet-up sm:animate-pop-in sm:rounded-3xl short:max-h-full short:animate-pop-in short:rounded-2xl ${MODAL_SIZES[size]}`}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-200 sm:hidden short:hidden" />
        {(title || dismissable) && (
          <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3 sm:px-6 sm:pt-5 short:px-4 short:pt-3 short:pb-2">
            <div className="min-w-0 flex-1">
              {title && <h2 className="text-lg font-bold text-slate-900 short:text-base">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-sm text-slate-500 short:text-xs">{subtitle}</p>}
            </div>
            {dismissable && (
              <button type="button" onClick={onClose} className="btn-icon -mr-2 -mt-1 short:size-9" aria-label="Tutup">
                <X className="size-5" />
              </button>
            )}
          </div>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 short:px-4 short:pb-3 ${bodyClassName}`}>{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-100 bg-slate-50/70 px-5 py-4 pb-safe sm:px-6 short:px-4 short:py-2.5">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// ---------- Toasts ----------

const ToastContext = createContext(null);

const TOAST_STYLE = {
  success: { icon: CheckCircle2, cls: 'text-emerald-500' },
  error: { icon: XCircle, cls: 'text-rose-500' },
  info: { icon: Info, cls: 'text-brand-500' },
  warning: { icon: AlertTriangle, cls: 'text-amber-500' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (type, message, opts = {}) => {
      const id = ++idRef.current;
      setToasts((list) => [...list.slice(-3), { id, type, message, title: opts.title }]);
      setTimeout(() => dismiss(id), opts.duration ?? 4000);
    },
    [dismiss]
  );

  const [api] = useState(() => ({}));
  api.success = (m, o) => push('success', m, o);
  api.error = (m, o) => push('error', m, o);
  api.info = (m, o) => push('info', m, o);
  api.warning = (m, o) => push('warning', m, o);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 p-3 sm:items-end sm:p-5">
          {toasts.map((t) => {
            const { icon: Icon, cls } = TOAST_STYLE[t.type];
            return (
              <div
                key={t.id}
                role="status"
                className="pointer-events-auto flex w-full max-w-sm animate-slide-in items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-3 shadow-xl shadow-slate-900/10 backdrop-blur"
              >
                <Icon className={`mt-0.5 size-5 shrink-0 ${cls}`} />
                <div className="min-w-0 flex-1 text-sm">
                  {t.title && <div className="font-bold text-slate-900">{t.title}</div>}
                  <div className="text-slate-600">{t.message}</div>
                </div>
                <button type="button" onClick={() => dismiss(t.id)} className="-mr-1 text-slate-400 hover:text-slate-700" aria-label="Tutup">
                  <X className="size-4" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- Confirm dialog ----------

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        setState({ ...options, resolve });
      }),
    []
  );

  const close = (value) => {
    state?.resolve(value);
    setState(null);
  };

  const tone = state?.tone ?? 'primary';
  const confirmClass = { primary: 'btn-primary', success: 'btn-success', danger: 'btn bg-rose-600 text-white hover:bg-rose-700 shadow-lg shadow-rose-600/20' }[tone];
  const Icon = state?.icon ?? (tone === 'danger' ? AlertTriangle : CheckCircle2);
  const iconClass = { primary: 'bg-brand-50 text-brand-600', success: 'bg-emerald-50 text-emerald-600', danger: 'bg-rose-50 text-rose-600' }[tone];

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={Boolean(state)} onClose={() => close(false)} size="sm">
        {state && (
          <div className="text-center sm:pt-2">
            <div className={`mx-auto mb-4 grid size-14 place-items-center rounded-2xl ${iconClass}`}>
              <Icon className="size-7" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">{state.title}</h3>
            {state.message && <div className="mt-2 text-sm text-slate-600">{state.message}</div>}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
                {state.cancelLabel ?? 'Batal'}
              </button>
              <button type="button" className={`btn ${confirmClass}`} onClick={() => close(true)} autoFocus>
                {state.confirmLabel ?? 'Ya, lanjutkan'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
