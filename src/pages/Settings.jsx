import { useEffect, useRef, useState } from 'react';
import {
  BellRing, Building2, Check, CheckCircle2, ClipboardPaste, Globe, ImageUp, Landmark, Pencil, Plus, QrCode, Store, Trash2, UserPlus, Users,
} from 'lucide-react';
import { AutoConfirmSettings } from './AutoConfirm.jsx';
import { api } from '../lib/api.js';
import { ROLE_LABEL, formatAccountNumber, rupiah } from '../lib/format.js';
import { decodeQrFromFile } from '../lib/media.js';
import { useAuth } from '../state/auth.jsx';
import { useData } from '../state/data.jsx';
import { PageHeader } from '../components/Shell.jsx';
import { AdminOnly } from './Products.jsx';
import { Avatar, EmptyState, Modal, QRImage, Spinner, useConfirm, useToast } from '../components/ui.jsx';

const TABS = [
  { id: 'toko', label: 'Toko & Cabang', icon: Store },
  { id: 'qris', label: 'QRIS', icon: QrCode },
  { id: 'bank', label: 'Rekening Bank', icon: Landmark },
  { id: 'otomatis', label: 'Konfirmasi Otomatis', icon: BellRing },
  { id: 'users', label: 'Pengguna', icon: Users },
];

function Section({ title, description, children, action }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Switcher between Shared (Pusat / Tetap) vs Store-specific payment configuration. */
function PaymentModeSwitch({ feature, useShared, storeName, sharedHint, storeHint, onChanged }) {
  const { setSettings } = useData();
  const { refreshStores } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const toggle = async (nextShared) => {
    if (nextShared === useShared || busy) return;
    setBusy(true);
    try {
      const updated = await api('/settings/payment-mode', {
        method: 'PUT',
        body: { feature, useShared: nextShared },
      });
      setSettings(updated);
      refreshStores().catch(() => {});
      onChanged?.(nextShared, updated);
      toast.success(nextShared ? 'Menggunakan pengaturan pusat (tetap)' : `Menggunakan pengaturan khusus ${storeName || 'toko ini'}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Mode Pengaturan</span>
        {busy && <Spinner className="size-4 text-brand-600" />}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => toggle(true)}
          className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
            useShared ? 'border-brand-500 bg-white ring-2 ring-brand-500/20' : 'border-slate-200 bg-white/60 hover:border-slate-300'
          }`}
        >
          <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${useShared ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
            <Globe className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-900">Ikut Pusat (Tetap)</span>
            <span className="block text-xs text-slate-500">Dipakai bersama semua cabang yang memilih opsi ini</span>
          </span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => toggle(false)}
          className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
            !useShared ? 'border-brand-500 bg-white ring-2 ring-brand-500/20' : 'border-slate-200 bg-white/60 hover:border-slate-300'
          }`}
        >
          <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${!useShared ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
            <Building2 className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-slate-900">Khusus {storeName || 'Toko Ini'}</span>
            <span className="block text-xs text-slate-500">Terpisah dan tidak memengaruhi toko lain</span>
          </span>
        </button>
      </div>
      <p className="mt-2.5 text-xs text-slate-600">{useShared ? sharedHint : storeHint}</p>
    </div>
  );
}

// ---------- Stores & Multi-Branch ----------

function CreateStoreModal({ onClose }) {
  const { stores, activeStoreId, setStores } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    address: '',
    phone: '',
    footer: 'Terima kasih atas kunjungan Anda!',
    paperWidth: 58,
    useSharedQris: true,
    useSharedBanks: true,
    useSharedAutoConfirm: true,
    copyProductsFromStoreId: '',
  });
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setCheck = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        copyProductsFromStoreId: form.copyProductsFromStoreId ? Number(form.copyProductsFromStoreId) : null,
      };
      const data = await api('/stores', { method: 'POST', body: payload });
      setStores(data.stores, data.store.id);
      toast.success(`Toko "${data.store.name}" ditambahkan dan diaktifkan`);
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Tambah Toko / Cabang Baru"
      subtitle="Produk, layar pelanggan, karyawan, dan riwayat transaksi terpisah per toko."
      size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Batal</button>
          <button type="submit" form="create-store-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner className="size-4" />} Buat Toko
          </button>
        </div>
      }
    >
      <form id="create-store-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ns-name">Nama toko / cabang</label>
            <input id="ns-name" className="input" value={form.name} onChange={set('name')} required maxLength={60} autoFocus placeholder="contoh: Kopi Senja Cabang 2" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ns-addr">Alamat</label>
            <input id="ns-addr" className="input" value={form.address} onChange={set('address')} maxLength={160} placeholder="Jl. ..." />
          </div>
          <div>
            <label className="label" htmlFor="ns-phone">Telepon / WhatsApp</label>
            <input id="ns-phone" className="input" value={form.phone} onChange={set('phone')} maxLength={30} inputMode="tel" />
          </div>
          <div>
            <span className="label">Lebar kertas struk</span>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              {[58, 80].map((w) => (
                <button key={w} type="button" onClick={() => setForm((f) => ({ ...f, paperWidth: w }))} className={`rounded-lg py-2 text-sm font-bold transition ${form.paperWidth === w ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {w} mm
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ns-copy">Salin daftar produk dari toko lain (opsional)</label>
            <select id="ns-copy" className="input" value={form.copyProductsFromStoreId} onChange={set('copyProductsFromStoreId')}>
              <option value="">Mulai kosong (tanpa produk)</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  Salin dari {s.name}{s.id === activeStoreId ? ' (aktif)' : ''}{s.counts ? ` (${s.counts.products} produk)` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Pembayaran & Notifikasi</div>
          <div className="space-y-2.5 text-sm">
            {[
              { key: 'useSharedQris', label: 'QRIS ikut Pusat (tetap)', desc: 'Matikan jika cabang ini punya QRIS sendiri.' },
              { key: 'useSharedBanks', label: 'Rekening bank ikut Pusat (tetap)', desc: 'Matikan jika cabang ini pakai rekening terpisah.' },
              { key: 'useSharedAutoConfirm', label: 'Konfirmasi otomatis ikut Pusat (tetap)', desc: 'Matikan jika cabang ini pakai HP/webhook MacroDroid sendiri.' },
            ].map((item) => (
              <label key={item.key} className="flex cursor-pointer items-start justify-between gap-3">
                <span>
                  <span className="block font-semibold text-slate-800">{item.label}</span>
                  <span className="block text-xs text-slate-500">{item.desc}</span>
                </span>
                <input type="checkbox" className="mt-1 size-5 shrink-0 accent-brand-600" checked={form[item.key]} onChange={setCheck(item.key)} />
              </label>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}

function StoreSettings() {
  const { stores, activeStoreId, selectStore, setStores, refreshStores } = useAuth();
  const { settings, setSettings } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState(settings.store);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => setForm(settings.store), [settings.store]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      setSettings(await api('/settings/store', { method: 'PUT', body: form }));
      refreshStores().catch(() => {});
      toast.success('Pengaturan toko disimpan');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeStore = async (store) => {
    const ok = await confirm({
      title: `Hapus toko “${store.name}”?`,
      message: 'Semua produk, riwayat transaksi, dan pengaturan khusus toko ini akan dihapus permanen. Karyawan di toko ini harus dipindahkan atau dihapus lebih dulu.',
      confirmLabel: 'Hapus Toko',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const data = await api(`/stores/${store.id}`, { method: 'DELETE' });
      setStores(data.stores);
      toast.success(`Toko "${store.name}" dihapus`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-5">
      <Section
        title="Daftar Toko / Cabang"
        description="Kelola banyak cabang dalam satu server. Produk, transaksi, layar pelanggan, dan karyawan terpisah per toko; sedangkan QRIS, rekening, dan konfirmasi otomatis bisa dibuat tetap (pusat) atau khusus per toko."
        action={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Tambah Toko
          </button>
        }
      >
        <ul className="divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-200">
          {stores.map((s) => {
            const active = s.id === activeStoreId;
            return (
              <li key={s.id} className={`flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center ${active ? 'bg-brand-50/50' : ''}`}>
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    <Store className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-bold text-slate-900">{s.name}</span>
                      {active && <span className="pill bg-brand-100 text-brand-700"><Check className="size-3" /> Aktif</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {s.counts ? `${s.counts.products} produk • ${s.counts.staff} karyawan` : ''}
                      {s.counts?.pending > 0 ? ` • ${s.counts.pending} menunggu` : ''}
                      {s.address ? ` • ${s.address}` : ''}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className={`pill text-[11px] ${s.useSharedQris ? 'bg-slate-100 text-slate-600' : 'bg-indigo-50 text-indigo-700'}`}>
                        QRIS: {s.useSharedQris ? 'Pusat' : 'Khusus'}
                      </span>
                      <span className={`pill text-[11px] ${s.useSharedBanks ? 'bg-slate-100 text-slate-600' : 'bg-indigo-50 text-indigo-700'}`}>
                        Bank: {s.useSharedBanks ? 'Pusat' : 'Khusus'}
                      </span>
                      <span className={`pill text-[11px] ${s.useSharedAutoConfirm ? 'bg-slate-100 text-slate-600' : 'bg-indigo-50 text-indigo-700'}`}>
                        Otomatis: {s.useSharedAutoConfirm ? 'Pusat' : 'Khusus'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!active && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectStore(s.id)}>
                      Buka Toko
                    </button>
                  )}
                  {stores.length > 1 && (
                    <button type="button" className="btn-icon size-9 hover:text-rose-600" onClick={() => removeStore(s)} aria-label="Hapus toko" title="Hapus toko">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title={`Detail & Struk • ${settings.store.name || 'Toko Aktif'}`}
        description="Ditampilkan di layar pelanggan dan bukti transaksi untuk toko yang sedang aktif."
      >
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="s-name">Nama toko</label>
            <input id="s-name" className="input" value={form.name || ''} onChange={set('name')} required maxLength={60} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="s-addr">Alamat</label>
            <input id="s-addr" className="input" value={form.address || ''} onChange={set('address')} maxLength={160} placeholder="Jl. ..." />
          </div>
          <div>
            <label className="label" htmlFor="s-phone">Telepon / WhatsApp</label>
            <input id="s-phone" className="input" value={form.phone || ''} onChange={set('phone')} maxLength={30} inputMode="tel" />
          </div>
          <div>
            <span className="label">Lebar kertas struk</span>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              {[58, 80].map((w) => (
                <button key={w} type="button" onClick={() => setForm((f) => ({ ...f, paperWidth: w }))} className={`rounded-lg py-2 text-sm font-bold transition ${form.paperWidth === w ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {w} mm
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="s-footer">Catatan bawah struk</label>
            <input id="s-footer" className="input" value={form.footer || ''} onChange={set('footer')} maxLength={160} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy && <Spinner className="size-4" />} Simpan</button>
          </div>
        </form>
      </Section>

      {creating && <CreateStoreModal onClose={() => setCreating(false)} />}
    </div>
  );
}

// ---------- QRIS ----------

function QrisSettings() {
  const { settings, setSettings } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef(null);
  const [candidate, setCandidate] = useState(null); // { payload, info, sample }
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const useShared = settings.qris?.useShared ?? true;

  const analyze = async (payload) => {
    setBusy(true);
    try {
      const data = await api('/settings/qris/analyze', { method: 'POST', body: { payload } });
      setCandidate({ payload, ...data });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const text = await decodeQrFromFile(file);
      if (!text) {
        toast.error('QR tidak terbaca. Gunakan foto yang lebih jelas/terang atau tempel kode QRIS secara manual.');
        setBusy(false);
        return;
      }
      await analyze(text);
    } catch (err) {
      toast.error(err.message);
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      setSettings(await api('/settings/qris', { method: 'PUT', body: { payload: candidate.payload } }));
      setCandidate(null);
      setPaste('');
      setShowPaste(false);
      toast.success('QRIS disimpan. Setiap transaksi kini otomatis memakai QRIS dengan nominal.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Hapus QRIS?', message: 'Pembayaran QRIS tidak bisa dipakai sampai QRIS diunggah lagi.', confirmLabel: 'Hapus', tone: 'danger' }))) return;
    try {
      setSettings(await api('/settings/qris', { method: 'DELETE' }));
      toast.success('QRIS dihapus');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Section
      title="QRIS"
      description="Unggah QRIS statis toko Anda (stiker/gambar dari aplikasi merchant). Kasira otomatis mengubahnya menjadi QRIS dinamis berisi nominal setiap transaksi, jadi pelanggan tidak perlu mengetik nominal."
    >
      <PaymentModeSwitch
        feature="qris"
        useShared={useShared}
        storeName={settings.store.name}
        sharedHint="QRIS Pusat (Tetap): perubahan di sini berlaku untuk semua toko yang memilih opsi Pusat."
        storeHint={`QRIS Khusus ${settings.store.name}: hanya dipakai oleh cabang ini dan tidak mengubah QRIS Pusat.`}
      />

      {settings.qris.configured ? (
        <div className="mb-5 flex items-center gap-4 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
          <CheckCircle2 className="size-8 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-emerald-900">
              QRIS aktif ({useShared ? 'Pusat' : settings.store.name}): {settings.qris.merchantName}
            </div>
            <div className="text-sm text-emerald-800">
              {settings.qris.merchantCity}{settings.qris.nmid ? ` • NMID: ${settings.qris.nmid}` : ''}
            </div>
          </div>
          <button type="button" className="btn btn-danger btn-sm" onClick={remove}><Trash2 className="size-4" /> Hapus</button>
        </div>
      ) : (
        <div className="mb-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          QRIS ({useShared ? 'Pusat' : settings.store.name}) belum diatur. Pembayaran QRIS belum bisa dipakai.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Spinner className="size-4" /> : <ImageUp className="size-4" />} {settings.qris.configured ? 'Ganti gambar QRIS' : 'Unggah gambar QRIS'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setShowPaste((s) => !s)}>
          <ClipboardPaste className="size-4" /> Tempel kode QRIS
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      {showPaste && (
        <div className="mt-4 space-y-2">
          <textarea className="input min-h-24 font-mono text-xs" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="000201010211..." />
          <button type="button" className="btn btn-secondary btn-sm" disabled={!paste.trim() || busy} onClick={() => analyze(paste.trim())}>Periksa kode</button>
        </div>
      )}

      <Modal open={Boolean(candidate)} onClose={() => setCandidate(null)} title="Periksa QRIS" size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button type="button" className="btn btn-secondary" onClick={() => setCandidate(null)}>Batal</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy && <Spinner className="size-4" />} Simpan QRIS</button>
          </div>
        }
      >
        {candidate && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Merchant</div>
              <div className="text-lg font-extrabold text-slate-900">{candidate.info.merchantName || '-'}</div>
              <div className="text-sm text-slate-600">{candidate.info.merchantCity}{candidate.info.nmid ? ` • NMID: ${candidate.info.nmid}` : ''}</div>
            </div>
            {!candidate.info.isStatic && (
              <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                Kode ini adalah QRIS dinamis (biasanya sekali pakai). Sebaiknya gunakan QRIS statis dari stiker atau aplikasi merchant Anda.
              </div>
            )}
            <div className="flex items-center gap-4">
              <div className="rounded-2xl bg-white p-2 shadow ring-1 ring-slate-200">
                <QRImage value={candidate.sample.payload} className="size-36" size={400} />
              </div>
              <div className="text-sm text-slate-600">
                Contoh QRIS dinamis <b className="text-slate-900">{rupiah(candidate.sample.amount)}</b>. Anda bisa mencoba scan (tanpa membayar) untuk memastikan nama merchant dan nominal muncul otomatis.
              </div>
            </div>
          </div>
        )}
      </Modal>
    </Section>
  );
}

// ---------- Banks ----------

function BankForm({ bank, onClose }) {
  const { setSettings } = useData();
  const toast = useToast();
  const [form, setForm] = useState({ bankName: bank?.bankName ?? '', accountNumber: bank?.accountNumber ?? '', accountName: bank?.accountName ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      setSettings(await api(bank ? `/settings/banks/${bank.id}` : '/settings/banks', { method: bank ? 'PUT' : 'POST', body: form }));
      toast.success('Rekening disimpan');
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={bank ? 'Edit rekening' : 'Tambah rekening'} size="sm"
      footer={<div className="flex justify-end gap-3"><button type="button" className="btn btn-secondary" onClick={onClose}>Batal</button><button type="submit" form="bank-form" className="btn btn-primary" disabled={busy}>{busy && <Spinner className="size-4" />} Simpan</button></div>}
    >
      <form id="bank-form" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="b-name">Nama bank</label>
          <input id="b-name" className="input" list="bank-list" value={form.bankName} onChange={set('bankName')} required maxLength={40} placeholder="BCA, BRI, Mandiri, ..." autoFocus />
          <datalist id="bank-list">{['BCA', 'BRI', 'BNI', 'Mandiri', 'BSI', 'CIMB Niaga', 'Permata', 'BTN', 'Danamon', 'SeaBank', 'Bank Jago', 'blu by BCA Digital'].map((b) => <option key={b} value={b} />)}</datalist>
        </div>
        <div>
          <label className="label" htmlFor="b-num">Nomor rekening</label>
          <input id="b-num" className="input font-mono" inputMode="numeric" value={form.accountNumber} onChange={set('accountNumber')} required maxLength={30} />
        </div>
        <div>
          <label className="label" htmlFor="b-owner">Atas nama</label>
          <input id="b-owner" className="input" value={form.accountName} onChange={set('accountName')} required maxLength={60} />
        </div>
      </form>
    </Modal>
  );
}

function BankSettings() {
  const { settings, setSettings } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null);
  const useShared = settings.banksMode?.useShared ?? true;

  const remove = async (bank) => {
    if (!(await confirm({ title: `Hapus rekening ${bank.bankName}?`, confirmLabel: 'Hapus', tone: 'danger' }))) return;
    try {
      setSettings(await api(`/settings/banks/${bank.id}`, { method: 'DELETE' }));
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Section
      title="Rekening Bank"
      description="Ditampilkan ke pelanggan saat memilih pembayaran transfer."
      action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><Plus className="size-4" /> Tambah</button>}
    >
      <PaymentModeSwitch
        feature="banks"
        useShared={useShared}
        storeName={settings.store.name}
        sharedHint="Rekening Pusat (Tetap): daftar rekening ini dipakai bersama oleh semua toko yang memilih opsi Pusat."
        storeHint={`Rekening Khusus ${settings.store.name}: hanya ditampilkan di cabang ini dan tidak mengubah Rekening Pusat.`}
      />

      {settings.banks.length === 0 ? (
        <EmptyState icon={Landmark} title="Belum ada rekening" description={`Tambahkan minimal satu rekening (${useShared ? 'Pusat' : settings.store.name}) untuk menerima transfer.`} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {settings.banks.map((bank) => (
            <div key={bank.id} className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 to-brand-900 p-5 text-white">
              <div className="pointer-events-none absolute -top-8 -right-8 size-28 rounded-full bg-fuchsia-500/25 blur-2xl" />
              <div className="text-sm font-bold uppercase tracking-wider text-white/80">{bank.bankName}</div>
              <div className="mt-2 font-mono text-xl font-bold tracking-wider">{formatAccountNumber(bank.accountNumber)}</div>
              <div className="text-sm text-white/70">a.n. {bank.accountName}</div>
              <div className="mt-4 flex gap-2">
                <button type="button" className="btn btn-sm bg-white/15 text-white hover:bg-white/25" onClick={() => setEditing(bank)}><Pencil className="size-3.5" /> Edit</button>
                <button type="button" className="btn btn-sm bg-white/10 text-rose-200 hover:bg-rose-500/30" onClick={() => remove(bank)}><Trash2 className="size-3.5" /> Hapus</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <BankForm bank={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

// ---------- Users ----------

function UserForm({ user, onClose, onSaved, isSelf }) {
  const { stores, activeStoreId } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    name: user?.name ?? '',
    username: user?.username ?? '',
    password: '',
    role: user?.role ?? 'karyawan',
    storeId: user?.storeId ?? activeStoreId ?? stores[0]?.id ?? '',
    active: user?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...form };
      if (user && !body.password) delete body.password;
      if (body.role === 'admin') delete body.storeId;
      else body.storeId = Number(body.storeId);
      await api(user ? `/users/${user.id}` : '/users', { method: user ? 'PUT' : 'POST', body });
      toast.success(user ? 'Pengguna diperbarui' : 'Pengguna ditambahkan');
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={user ? 'Edit pengguna' : 'Tambah pengguna'} size="sm"
      footer={<div className="flex justify-end gap-3"><button type="button" className="btn btn-secondary" onClick={onClose}>Batal</button><button type="submit" form="user-form" className="btn btn-primary" disabled={busy}>{busy && <Spinner className="size-4" />} Simpan</button></div>}
    >
      <form id="user-form" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="u-name">Nama</label>
          <input id="u-name" className="input" value={form.name} onChange={set('name')} required maxLength={60} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="u-username">Username</label>
          <input id="u-username" className="input" value={form.username} onChange={set('username')} required maxLength={32} autoCapitalize="none" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="u-pass">{user ? 'Kata sandi baru' : 'Kata sandi'}</label>
          <input id="u-pass" type="password" className="input" value={form.password} onChange={set('password')} required={!user} minLength={6} autoComplete="new-password" placeholder={user ? 'Kosongkan jika tidak diganti' : 'Minimal 6 karakter'} />
        </div>
        <div>
          <span className="label">Peran</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'karyawan', desc: 'Jual & konfirmasi di 1 toko' },
              { id: 'admin', desc: 'Akses penuh semua toko' },
            ].map((r) => (
              <button key={r.id} type="button" disabled={isSelf} onClick={() => setForm((f) => ({ ...f, role: r.id }))}
                className={`rounded-xl border p-3 text-left transition ${form.role === r.id ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="text-sm font-bold text-slate-900">{ROLE_LABEL[r.id]}</div>
                <div className="text-xs text-slate-500">{r.desc}</div>
              </button>
            ))}
          </div>
        </div>
        {form.role === 'karyawan' ? (
          <div>
            <label className="label" htmlFor="u-store">Toko yang ditugaskan</label>
            <select id="u-store" className="input" value={form.storeId} onChange={set('storeId')} required>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <p className="hint">Karyawan hanya dapat melihat dan melayani transaksi di toko ini.</p>
          </div>
        ) : (
          <div className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-xs text-brand-800 ring-1 ring-brand-200">
            Admin memiliki akses penuh untuk mengelola dan berpindah ke semua toko/cabang.
          </div>
        )}
        {user && !isSelf && (
          <label className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
            <span className="text-sm font-semibold text-slate-700">Akun aktif</span>
            <input type="checkbox" className="size-5 accent-brand-600" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          </label>
        )}
      </form>
    </Modal>
  );
}

function UserSettings() {
  const { user: me, refreshStores } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => api('/users').then((d) => setUsers(d.users)).catch((e) => toast.error(e.message));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (u) => {
    if (!(await confirm({ title: `Hapus ${u.name}?`, message: 'Akun tidak bisa login lagi. Riwayat transaksinya tetap tersimpan.', confirmLabel: 'Hapus', tone: 'danger' }))) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      load();
      refreshStores().catch(() => {});
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Section
      title="Pengguna"
      description="Admin dapat mengelola semua toko & harga. Karyawan dikunci pada satu toko tertentu dan tidak dapat mengubah harga."
      action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><UserPlus className="size-4" /> Tambah</button>}
    >
      {!users ? (
        <div className="grid place-items-center py-10 text-slate-400"><Spinner /></div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-200">
          {users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={u.name} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                  {u.name} {u.id === me.id && <span className="pill bg-slate-100 text-slate-600">Anda</span>}
                  {!u.active && <span className="pill bg-rose-50 text-rose-600">Nonaktif</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span>@{u.username}</span>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                    <Store className="size-3" /> {u.role === 'admin' ? 'Semua toko' : u.storeName || 'Belum dipilih'}
                  </span>
                </div>
              </div>
              <span className={`pill ${u.role === 'admin' ? 'bg-brand-50 text-brand-700' : 'bg-sky-50 text-sky-700'}`}>{ROLE_LABEL[u.role]}</span>
              <button type="button" className="btn-icon size-9" onClick={() => setEditing(u)} aria-label="Edit"><Pencil className="size-4" /></button>
              {u.id !== me.id && <button type="button" className="btn-icon size-9 hover:text-rose-600" onClick={() => remove(u)} aria-label="Hapus"><Trash2 className="size-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          isSelf={editing !== 'new' && editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            refreshStores().catch(() => {});
          }}
        />
      )}
    </Section>
  );
}

export default function SettingsPage() {
  const { user, stores } = useAuth();
  const { settings } = useData();
  const [tab, setTab] = useState('toko');
  if (user.role !== 'admin') return <AdminOnly />;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8 short:px-5 short:py-4">
      <PageHeader
        title="Pengaturan"
        description={
          stores.length > 1 && settings.store.name
            ? `Toko aktif: ${settings.store.name} • Atur cabang, metode pembayaran, dan akun karyawan.`
            : 'Atur toko, cabang, metode pembayaran, dan akun karyawan.'
        }
      />
      <div className="scrollbar-none -mx-4 mb-5 flex gap-2 overflow-x-auto px-4">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`chip ${tab === id ? 'chip-on' : 'chip-off'}`}>
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      {tab === 'toko' && <StoreSettings />}
      {tab === 'qris' && <QrisSettings />}
      {tab === 'bank' && <BankSettings />}
      {tab === 'otomatis' && <AutoConfirmSettings Section={Section} PaymentModeSwitch={PaymentModeSwitch} />}
      {tab === 'users' && <UserSettings />}
    </div>
  );
}
