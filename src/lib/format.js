const rupiahFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat('id-ID');

export const rupiah = (n) => rupiahFormatter.format(n || 0);
export const formatNumber = (n) => numberFormatter.format(n || 0);

export const formatDateTime = (ms) =>
  new Date(ms).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

export const formatTime = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

export const formatDateLong = (ms) =>
  new Date(ms).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function timeAgo(ms, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 45) return 'baru saja';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return formatDateTime(ms);
}

export function initials(name = '') {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Parse a user-typed rupiah amount ("15.000" -> 15000). */
export const parseRupiahInput = (value) => Number(String(value).replace(/\D/g, '').slice(0, 12)) || 0;

export const METHOD_LABEL = { qris: 'QRIS', transfer: 'Transfer Bank' };
export const STATUS_LABEL = { pending: 'Menunggu', paid: 'Lunas', cancelled: 'Dibatalkan' };
export const ROLE_LABEL = { admin: 'Admin', karyawan: 'Karyawan' };

const TILE_GRADIENTS = [
  'from-orange-400 to-rose-500',
  'from-sky-400 to-indigo-500',
  'from-emerald-400 to-teal-600',
  'from-fuchsia-500 to-purple-600',
  'from-amber-300 to-orange-500',
  'from-cyan-400 to-blue-600',
  'from-lime-400 to-emerald-600',
  'from-pink-400 to-fuchsia-600',
  'from-violet-400 to-indigo-600',
  'from-red-400 to-orange-500',
];

export function tileGradient(seed = '') {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return TILE_GRADIENTS[Math.abs(hash) % TILE_GRADIENTS.length];
}

/** Start/end (epoch ms) of the local day containing `date`. */
export function dayRange(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.getTime(), to: end.getTime() };
}

export function toDateInputValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatAccountNumber(value = '') {
  const digits = value.replace(/\s+/g, '');
  return /^\d+$/.test(digits) ? digits.replace(/(\d{4})(?=\d)/g, '$1 ') : value;
}
