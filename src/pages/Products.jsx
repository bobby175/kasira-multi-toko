import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Lock, Package, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatNumber, parseRupiahInput, rupiah } from '../lib/format.js';
import { imageFileToSquareDataUrl } from '../lib/media.js';
import { useAuth } from '../state/auth.jsx';
import { useData } from '../state/data.jsx';
import { PageHeader } from '../components/Shell.jsx';
import { EmptyState, Modal, ProductThumb, Spinner, useConfirm, useToast } from '../components/ui.jsx';

export function AdminOnly() {
  return (
    <div className="mx-auto max-w-lg p-8">
      <div className="card">
        <EmptyState icon={Lock} title="Khusus admin" description="Halaman ini hanya bisa dibuka oleh admin. Karyawan tidak dapat mengubah produk atau harga." />
      </div>
    </div>
  );
}

function ProductForm({ product, categories, onClose, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef(null);
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(product ? formatNumber(product.price) : '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [image, setImage] = useState(product?.image ?? null); // url or data URL
  const [imageChanged, setImageChanged] = useState(false);
  const [busy, setBusy] = useState(false);

  const pickImage = async (file) => {
    if (!file) return;
    try {
      setImage(await imageFileToSquareDataUrl(file));
      setImageChanged(true);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const body = { name, price: parseRupiahInput(price), category };
    if (imageChanged) body.image = image; // data URL or null (remove)
    setBusy(true);
    try {
      if (product) await api(`/products/${product.id}`, { method: 'PUT', body });
      else await api('/products', { method: 'POST', body });
      toast.success(product ? 'Produk diperbarui' : 'Produk ditambahkan');
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: `Hapus “${product.name}”?`, message: 'Riwayat transaksi lama tetap tersimpan.', confirmLabel: 'Hapus', tone: 'danger' });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/products/${product.id}`, { method: 'DELETE' });
      toast.success('Produk dihapus');
      onSaved();
    } catch (err) {
      toast.error(err.message);
      setBusy(false);
    }
  };

  const preview = { name: name || 'Produk', image };

  return (
    <Modal
      open
      onClose={onClose}
      title={product ? 'Edit produk' : 'Tambah produk'}
      footer={
        <div className="flex gap-3">
          {product && (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              <Trash2 className="size-4" /> <span className="hidden sm:inline">Hapus</span>
            </button>
          )}
          <button type="button" className="btn btn-secondary ml-auto" onClick={onClose} disabled={busy}>Batal</button>
          <button type="submit" form="product-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner className="size-4" />} Simpan
          </button>
        </div>
      }
    >
      <form id="product-form" onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => fileRef.current?.click()} className="group relative size-28 shrink-0 overflow-hidden rounded-2xl ring-1 ring-slate-200">
            <ProductThumb product={preview} className="size-full text-2xl" />
            <span className="absolute inset-0 grid place-items-center bg-slate-900/40 text-white opacity-0 transition group-hover:opacity-100">
              <ImagePlus className="size-6" />
            </span>
          </button>
          <div className="space-y-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
              <ImagePlus className="size-4" /> {image ? 'Ganti foto' : 'Tambah foto'}
            </button>
            {image && (
              <button type="button" className="btn btn-ghost btn-sm block text-rose-600" onClick={() => { setImage(null); setImageChanged(true); }}>
                Hapus foto
              </button>
            )}
            <p className="text-xs text-slate-500">Opsional. Tanpa foto, kartu produk memakai warna otomatis.</p>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <div>
          <label className="label" htmlFor="p-name">Nama produk</label>
          <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus placeholder="contoh: Kopi Susu Gula Aren" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="p-price">Harga</label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm font-bold text-slate-400">Rp</span>
              <input
                id="p-price"
                className="input pl-11 font-semibold"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value ? formatNumber(parseRupiahInput(e.target.value)) : '')}
                required
                placeholder="0"
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="p-cat">Kategori</label>
            <input id="p-cat" className="input" list="category-list" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={40} placeholder="contoh: Minuman" />
            <datalist id="category-list">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function ProductsPage() {
  const { user } = useAuth();
  const { products, productsLoaded, refreshProducts, activeStoreId, settings, stores } = useData();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | product

  useEffect(() => {
    setQuery('');
    setEditing(null);
  }, [activeStoreId]);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) : products;
  }, [products, query]);

  if (user.role !== 'admin') return <AdminOnly />;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8 short:px-5 short:py-4">
      <PageHeader
        title="Produk"
        description={`${stores.length > 1 && settings.store.name ? `${settings.store.name} • ` : ''}${products.length} produk • hanya admin yang dapat menambah dan mengubah harga`}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> Tambah Produk
          </button>
        }
      />
      {products.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama atau kategori" className="input pl-9" />
        </div>
      )}
      {!productsLoaded ? (
        <div className="grid place-items-center py-16 text-slate-400"><Spinner className="size-7" /></div>
      ) : products.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Package}
            title="Belum ada produk"
            description="Tambahkan menu atau barang yang Anda jual beserta harganya."
            action={<button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Plus className="size-4" /> Tambah Produk</button>}
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {filtered.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setEditing(p)} className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-slate-50 sm:px-5">
                  <ProductThumb product={p} className="size-14 shrink-0 rounded-xl text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.category || 'Tanpa kategori'}</div>
                  </div>
                  <div className="text-right font-extrabold text-brand-700">{rupiah(p.price)}</div>
                  <Pencil className="size-4 shrink-0 text-slate-300" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && (
        <ProductForm
          key={editing === 'new' ? 'new' : editing.id}
          product={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refreshProducts();
          }}
        />
      )}
    </div>
  );
}
