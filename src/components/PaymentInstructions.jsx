import { Landmark, ScanLine, Sparkles } from 'lucide-react';
import { QRImage } from './ui.jsx';
import { formatAccountNumber, rupiah } from '../lib/format.js';

/**
 * Payment info shown to the customer (QRIS code or bank accounts).
 * Purely informational: it intentionally has no confirm buttons.
 * `tone="dark"` + `size="lg"` is used by the customer display.
 *
 * On phones held in landscape (`short:`), the QR is sized from the screen height and the
 * total under it is hidden, because the order summary beside it already shows the total.
 */
export function PaymentInstructions({ method, total, qrisPayload, qris, banks = [], tone = 'light', size = 'md' }) {
  const dark = tone === 'dark';
  const big = size === 'lg';

  if (method === 'qris') {
    return (
      <div className="flex flex-col items-center text-center">
        <div
          className={`w-full rounded-[28px] bg-white p-4 shadow-2xl short:max-w-none short:rounded-2xl short:p-3 ${
            dark ? 'shadow-brand-500/30' : 'shadow-slate-900/10 ring-1 ring-slate-200'
          } ${big ? 'max-w-[440px] sm:p-6 short:w-[calc(100dvh-6.5rem)]' : 'max-w-[320px] short:w-[calc(100dvh-7.25rem)]'}`}
        >
          <div className="mb-3 flex items-center justify-between short:mb-2">
            <span className="rounded-md bg-slate-900 px-2 py-0.5 text-sm font-black tracking-[0.2em] text-white short:text-xs">QRIS</span>
            <span className={`flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap text-slate-500 ${big ? '' : 'short:hidden'}`}>
              <Sparkles className="size-3.5 text-amber-500" /> Nominal otomatis
            </span>
          </div>
          <QRImage value={qrisPayload} className="aspect-square w-full rounded-xl" size={big ? 880 : 640} />
          {(qris?.merchantName || qris?.nmid) && (
            <div className="mt-3 text-slate-800 short:hidden">
              <div className="truncate text-sm font-extrabold uppercase">{qris.merchantName}</div>
              {qris.nmid && <div className="text-[11px] font-medium text-slate-500">NMID: {qris.nmid}</div>}
            </div>
          )}
        </div>
        <div className="short:hidden">
          <div className={`mt-5 flex items-center justify-center gap-2 text-sm ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
            <ScanLine className="size-4 shrink-0" />
            Scan dengan e-wallet atau m-banking apa pun
          </div>
          <div className={`mt-1 font-extrabold tracking-tight ${dark ? 'text-white' : 'text-slate-900'} ${big ? 'text-5xl' : 'text-3xl'}`}>
            {rupiah(total)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${big ? '' : 'short:w-[min(44vw,320px)]'} short:max-h-[calc(100dvh-7rem)] short:overflow-y-auto`}>
      <div className={`mb-3 text-sm font-semibold short:mb-2 short:text-xs ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
        Transfer ke {banks.length > 1 ? 'salah satu rekening' : 'rekening'} berikut:
      </div>
      <div className="grid gap-3 short:gap-2">
        {banks.map((bank) => (
          <div
            key={bank.id}
            className={`relative overflow-hidden rounded-3xl p-5 short:rounded-2xl short:p-3.5 ${
              dark ? 'bg-white/[0.07] ring-1 ring-white/15' : 'bg-linear-to-br from-slate-900 to-brand-900 text-white shadow-lg'
            }`}
          >
            <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-fuchsia-500/20 blur-2xl" />
            <div className="flex items-center gap-2 text-white/80">
              <Landmark className="size-4" />
              <span className="text-sm font-bold uppercase tracking-wider short:text-xs">{bank.bankName}</span>
            </div>
            <div className={`mt-2 font-mono font-bold tracking-wider text-white short:mt-1 ${big ? 'text-4xl short:text-2xl' : 'text-2xl short:text-lg'}`}>
              {formatAccountNumber(bank.accountNumber)}
            </div>
            <div className="mt-1 text-sm text-white/70 short:mt-0 short:text-xs">a.n. {bank.accountName}</div>
          </div>
        ))}
      </div>
      <div className={`mt-5 rounded-2xl px-4 py-3 short:hidden ${dark ? 'bg-white/5' : 'bg-slate-50 ring-1 ring-slate-200'}`}>
        <div className={`text-xs font-semibold uppercase tracking-wider ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          Jumlah transfer
        </div>
        <div className={`font-extrabold tracking-tight ${dark ? 'text-white' : 'text-slate-900'} ${big ? 'text-5xl' : 'text-3xl'}`}>
          {rupiah(total)}
        </div>
        <div className={`mt-1 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Mohon transfer sesuai nominal di atas.</div>
      </div>
    </div>
  );
}
