import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, Copy, FlaskConical, RefreshCw, Smartphone, Store } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatTime, rupiah } from '../lib/format.js';
import { copyText } from '../lib/media.js';
import { useAuth } from '../state/auth.jsx';
import { useData } from '../state/data.jsx';
import { Spinner, useConfirm, useToast } from '../components/ui.jsx';

const RESULT = {
  test: { label: 'Tes koneksi OK', cls: 'bg-sky-100 text-sky-700' },
  confirmed: { label: 'Terkonfirmasi', cls: 'bg-emerald-100 text-emerald-700' },
  would_confirm: { label: 'Cocok', cls: 'bg-brand-50 text-brand-700' },
  ambiguous: { label: 'Nominal ganda, cek manual', cls: 'bg-amber-100 text-amber-800' },
  no_match: { label: 'Tidak ada yang cocok', cls: 'bg-slate-100 text-slate-600' },
  no_amount: { label: 'Nominal tidak terbaca', cls: 'bg-slate-100 text-slate-600' },
  ignored: { label: 'Diabaikan', cls: 'bg-slate-100 text-slate-600' },
  duplicate: { label: 'Duplikat', cls: 'bg-slate-100 text-slate-600' },
};

const BODY_TEMPLATE = '{not_app_name}\n{not_title}\n{notification} {not_text_big}\n{not_timestamp}';

const isLocalHost = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);

function ResultPill({ result }) {
  const r = RESULT[result] ?? RESULT.no_match;
  return <span className={`pill ${r.cls}`}>{r.label}</span>;
}

function CopyButton({ text, label = 'Salin' }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm shrink-0"
      onClick={async () => ((await copyText(text)) ? toast.success('Disalin') : toast.error('Gagal menyalin'))}
    >
      <Copy className="size-3.5" /> {label}
    </button>
  );
}

export function AutoConfirmSettings({ Section, PaymentModeSwitch }) {
  const { activeStoreId, stores } = useAuth();
  const { notifyTick, setSettings } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [originIndex, setOriginIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState(null);

  const load = useCallback(
    (resetForm = false) =>
      api('/settings/autoconfirm')
        .then((d) => {
          setData(d);
          setForm((f) => (resetForm || !f ? { enabled: d.enabled, windowMinutes: d.windowMinutes, ignoreWords: d.ignoreWords } : f));
        })
        .catch((e) => toast.error(e.message)),
    [toast]
  );

  useEffect(() => {
    setData(null);
    setForm(null);
    setTestResult(null);
    load(true);
  }, [activeStoreId, load]);

  useEffect(() => {
    if (notifyTick > 0) load(false);
  }, [notifyTick, load]); // refresh the log whenever a notification arrives

  if (!data || !form) return <div className="grid place-items-center py-16 text-slate-400"><Spinner className="size-7" /></div>;

  const origins = [];
  if (!isLocalHost(window.location.hostname)) origins.push(window.location.origin);
  for (const url of data.lanUrls) if (!origins.includes(url)) origins.push(url);
  if (origins.length === 0) origins.push(window.location.origin);
  const webhookUrl = origins[Math.min(originIndex, origins.length - 1)] + data.webhookPath;

  const save = async (next = form) => {
    setBusy(true);
    try {
      const d = await api('/settings/autoconfirm', { method: 'PUT', body: { ...next, windowMinutes: Number(next.windowMinutes) } });
      setData(d);
      setForm({ enabled: d.enabled, windowMinutes: d.windowMinutes, ignoreWords: d.ignoreWords });
      setSettings((s) => ({ ...s, autoConfirm: { enabled: d.enabled, useShared: d.useShared, scope: d.scope } }));
      toast.success(d.enabled ? 'Konfirmasi otomatis aktif' : 'Konfirmasi otomatis dimatikan');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    const ok = await confirm({
      title: 'Ganti alamat webhook?',
      message: 'Alamat lama langsung tidak berlaku. Perbarui URL di aplikasi penerus notifikasi (MacroDroid) di HP Anda.',
      confirmLabel: 'Ganti',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      setData(await api('/settings/autoconfirm/regenerate', { method: 'POST' }));
      toast.success('Alamat webhook baru dibuat');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const runTest = async () => {
    try {
      setTestResult(await api('/settings/autoconfirm/test', { method: 'POST', body: { text: testText } }));
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-5">
      <Section
        title="Konfirmasi Otomatis"
        description="Kasira membaca notifikasi pembayaran (aplikasi merchant QRIS atau m-banking) yang diteruskan dari HP Android. Jika nominalnya cocok dengan tepat satu pembayaran yang menunggu, pembayaran langsung lunas. Tombol konfirmasi manual tetap bisa dipakai kapan saja."
      >
        {PaymentModeSwitch && (
          <PaymentModeSwitch
            feature="autoconfirm"
            useShared={data.useShared}
            storeName={data.storeName}
            sharedHint={
              data.sharedStoreNames?.length > 1
                ? `Dipakai bersama oleh: ${data.sharedStoreNames.join(', ')}. Satu webhook MacroDroid otomatis mencocokkan pembayaran di cabang-cabang tersebut.`
                : 'Pengaturan tetap (pusat). Semua cabang yang memilih opsi Pusat memakai webhook MacroDroid yang sama.'
            }
            storeHint={`Khusus ${data.storeName}. Webhook ini hanya mencocokkan pembayaran di toko ${data.storeName}.`}
            onChanged={() => {
              setTestResult(null);
              load(true);
            }}
          />
        )}

        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <span className="flex items-center gap-3">
            <span className={`grid size-10 place-items-center rounded-xl ${form.enabled ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
              <BellRing className="size-5" />
            </span>
            <span>
              <span className="block font-bold text-slate-900">
                Aktifkan konfirmasi otomatis {stores.length > 1 ? (data.useShared ? '(Pusat / Tetap)' : `(${data.storeName})`) : ''}
              </span>
              <span className="block text-sm text-slate-500">{form.enabled ? 'Aktif' : 'Nonaktif: notifikasi hanya dicatat, tidak mengonfirmasi'}</span>
            </span>
          </span>
          <input
            type="checkbox"
            className="peer sr-only"
            checked={form.enabled}
            onChange={(e) => {
              const next = { ...form, enabled: e.target.checked };
              setForm(next);
              save(next);
            }}
          />
          <span className="relative h-7 w-12 shrink-0 rounded-full bg-slate-300 transition peer-checked:bg-emerald-500 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/30 after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ac-window">Cocokkan pembayaran dari ... menit terakhir</label>
            <input id="ac-window" type="number" min={1} max={240} className="input" value={form.windowMinutes} onChange={(e) => setForm({ ...form, windowMinutes: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ac-ignore">Abaikan notifikasi yang mengandung kata</label>
            <input id="ac-ignore" className="input" value={form.ignoreWords} onChange={(e) => setForm({ ...form, ignoreWords: e.target.value })} placeholder={data.defaultIgnoreWords} />
            <p className="hint">Pisahkan dengan koma. Mencegah uang keluar ikut terbaca sebagai pembayaran.</p>
          </div>
        </div>
        <button type="button" className="btn btn-primary mt-4" disabled={busy} onClick={() => save()}>
          {busy && <Spinner className="size-4" />} Simpan
        </button>

        <div className="mt-5 flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <AlertTriangle className="size-5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p>Pembayaran tidak dikonfirmasi otomatis jika ada dua pembayaran menunggu dengan nominal sama. Staf mendapat peringatan untuk mengonfirmasi manual.</p>
            <p>Atur aplikasi penerus agar hanya membaca aplikasi merchant/bank Anda, bukan semua aplikasi.</p>
          </div>
        </div>
      </Section>

      <Section
        title={`Alamat webhook ${stores.length > 1 ? (data.useShared ? '(Pusat / Tetap)' : `(${data.storeName})`) : ''}`}
        description="Alamat rahasia tujuan notifikasi dari HP Android. Jangan dibagikan: siapa pun yang tahu alamat ini bisa mengirim notifikasi palsu."
      >
        {origins.length > 1 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {origins.map((o, i) => (
              <button key={o} type="button" onClick={() => setOriginIndex(i)} className={`chip text-xs ${i === originIndex ? 'chip-on' : 'chip-off'}`}>
                {o.replace(/^https?:\/\//, '')}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 rounded-xl bg-slate-900 px-3 py-2.5 font-mono text-xs break-all text-emerald-200">{webhookUrl}</div>
          <div className="flex gap-2">
            <CopyButton text={webhookUrl} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={regenerate}>
              <RefreshCw className="size-3.5" /> Ganti
            </button>
          </div>
        </div>
      </Section>

      <Section title="Cara pasang di HP Android (MacroDroid)" description="Pasang di HP yang menerima notifikasi pembayaran. iPhone tidak mengizinkan aplikasi membaca notifikasi aplikasi lain.">
        <ol className="space-y-3 text-sm text-slate-700">
          {[
            <>Di HP yang menerima notifikasi pembayaran, sambungkan ke Wi-Fi yang sama dengan server Kasira (atau jaringan Tailscale / HTTPS), lalu buka alamat Kasira (mis. <b>{origins[0]}</b>) di browser HP. Halaman harus terbuka.</>,
            <>Install <b>MacroDroid</b> dari Play Store. Buat Macro baru. Pemicu: <b>Notification → Notification Received</b>, pilih <b>Select Applications</b> lalu centang aplikasi merchant QRIS / m-banking Anda saja. Izinkan <b>akses notifikasi</b> saat diminta.</>,
            <>Aksi: <b>HTTP Request</b>, metode <b>POST</b>, URL = alamat webhook di atas. Di <b>Content Body</b> pilih tipe <b>text/plain</b> lalu isi:</>,
            <>Simpan macro. Uji dengan <b>Test actions</b> di MacroDroid: di &quot;Notifikasi terakhir&quot; di bawah harus muncul <b>Tes koneksi OK</b>. Setelah itu coba pembayaran kecil sungguhan.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
              <div className="min-w-0 flex-1 pt-0.5">
                {step}
                {i === 2 && (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                    <pre className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-slate-900 px-3 py-2.5 font-mono text-xs text-slate-100">{BODY_TEMPLATE}</pre>
                    <CopyButton text={BODY_TEMPLATE} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
          <Smartphone className="size-4 shrink-0" />
          Matikan optimasi baterai untuk MacroDroid (di Xiaomi/Oppo/Vivo juga izinkan &quot;Autostart&quot;) agar tetap berjalan di latar belakang. Aplikasi lain yang bisa mengirim HTTP POST (Tasker, Automate) juga bisa dipakai dengan alamat yang sama.
        </p>
      </Section>

      <Section title="Uji teks notifikasi" description="Tempel contoh teks notifikasi untuk melihat nominal yang terbaca dan pembayaran yang cocok. Tidak mengubah data apa pun.">
        <textarea className="input min-h-20 text-sm" value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="contoh: Pembayaran QRIS Rp51.000 diterima dari pelanggan" />
        <button type="button" className="btn btn-secondary btn-sm mt-2" disabled={!testText.trim()} onClick={runTest}>
          <FlaskConical className="size-4" /> Coba
        </button>
        {testResult && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
            <ResultPill result={testResult.result} />
            <span className="text-slate-600">
              Nominal terbaca: <b>{testResult.amounts.length ? testResult.amounts.map(rupiah).join(', ') : '-'}</b>
            </span>
            {testResult.transaction && (
              <span className="text-slate-600">
                → <b>{testResult.transaction.code}</b> ({rupiah(testResult.transaction.total)})
                {testResult.transaction.storeName ? ` • ${testResult.transaction.storeName}` : ''}
              </span>
            )}
            {testResult.detail && <span className="w-full text-xs text-slate-500">{testResult.detail}</span>}
          </div>
        )}
      </Section>

      <Section
        title="Notifikasi terakhir"
        description="Setiap notifikasi yang diterima dan hasilnya."
        action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => load(false)}><RefreshCw className="size-3.5" /> Muat ulang</button>}
      >
        {data.recent.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500 ring-1 ring-slate-200">Belum ada notifikasi masuk. Setelah MacroDroid terpasang, notifikasi pembayaran akan tercatat di sini.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-200">
            {data.recent.map((n) => (
              <li key={n.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="w-12 shrink-0 text-xs font-semibold text-slate-500">{formatTime(n.receivedAt)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-500">{n.source || 'Tanpa nama aplikasi'}</div>
                  {/* the trailing number is the notification timestamp, kept only for duplicate detection */}
                  <div className="line-clamp-2 text-sm text-slate-800">{n.text.replace(/\s\d{10,13}$/, '')}</div>
                  {n.detail && <div className="text-xs text-slate-500">{n.detail}</div>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                  <ResultPill result={n.result} />
                  {n.txCode && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="size-3.5" /> {n.txCode}
                    </span>
                  )}
                  {data.useShared && n.txStoreName && stores.length > 1 && (
                    <span className="pill bg-slate-100 text-slate-600">
                      <Store className="size-3" /> {n.txStoreName}
                    </span>
                  )}
                  {n.amounts.length > 0 && <span className="text-xs text-slate-500">{n.amounts.map(rupiah).join(', ')}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
