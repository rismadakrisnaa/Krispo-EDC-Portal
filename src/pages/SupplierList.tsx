import React, { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Cpu, Edit2, Plus, Search, Trash2, Truck } from 'lucide-react';
import { db, describeError } from '../lib/firebase';
import { DEFAULT_WARRANTY_MONTHS, DEVICE_CATEGORIES } from '../lib/constants';
import { cn, matchesSearch, toNumber } from '../lib/utils';
import type { DeviceModel, Supplier } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useNav } from '../context/NavContext';
import { EmptyState, Field, Modal, PageHeader, btnPrimary, btnSecondary, inputClass, useFeedback } from '../components/ui';

const emptySupplier = { name: '', contactName: '', phone: '', email: '', address: '', notes: '' };
const emptyModel = { brand: '', model: '', category: 'EDC Android', warrantyMonths: String(DEFAULT_WARRANTY_MONTHS), notes: '' };

/**
 * Supplier = pihak yang menjual / mengirim unit (vendor / distributor).
 * Model = brand & tipe perangkat. Keduanya dipisah karena satu supplier bisa menjual
 * beberapa brand, dan satu brand bisa dibeli dari beberapa supplier.
 */
export function SupplierList() {
  const { suppliers, models, assets } = useData();
  const { can } = useAuth();
  const { go } = useNav();
  const { toast, confirm } = useFeedback();
  const canWrite = can('suppliers.write');

  const [tab, setTab] = useState<'suppliers' | 'models'>('suppliers');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [supplierForm, setSupplierForm] = useState<{ id?: string; data: typeof emptySupplier } | null>(null);
  const [modelForm, setModelForm] = useState<{ id?: string; data: typeof emptyModel } | null>(null);

  // Jumlah unit per supplier & per model, dari data aset yang sama dengan menu Aset.
  const usage = useMemo(() => {
    const bySupplier = new Map<string, number>();
    const byModel = new Map<string, number>();
    for (const a of assets) {
      if (a.supplierId) bySupplier.set(a.supplierId, (bySupplier.get(a.supplierId) || 0) + 1);
      if (a.assetType === 'perangkat') {
        const key = `${(a.vendor || '').toLowerCase()}|${(a.model || '').toLowerCase()}`;
        byModel.set(key, (byModel.get(key) || 0) + 1);
      }
    }
    return { bySupplier, modelCount: (m: DeviceModel) => byModel.get(`${m.brand.toLowerCase()}|${m.model.toLowerCase()}`) || 0 };
  }, [assets]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast(success);
      return true;
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  async function saveSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierForm) return;
    const data = Object.fromEntries(Object.entries(supplierForm.data).map(([k, v]) => [k, String(v).trim()])) as typeof emptySupplier;
    if (suppliers.some(s => s.id !== supplierForm.id && s.name.trim().toLowerCase() === data.name.toLowerCase())) return toast(`Supplier "${data.name}" sudah ada.`, 'error');
    const ok = await run(
      () => supplierForm.id
        ? updateDoc(doc(db, 'suppliers', supplierForm.id), { ...data, updatedAt: serverTimestamp() })
        : addDoc(collection(db, 'suppliers'), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      supplierForm.id ? 'Supplier diperbarui.' : `Supplier ${data.name} ditambahkan.`,
    );
    if (ok) setSupplierForm(null);
  }

  async function saveModel(e: React.FormEvent) {
    e.preventDefault();
    if (!modelForm) return;
    const data = {
      brand: modelForm.data.brand.trim().toUpperCase(),
      model: modelForm.data.model.trim(),
      category: modelForm.data.category,
      warrantyMonths: Math.round(toNumber(modelForm.data.warrantyMonths, 0)),
      notes: modelForm.data.notes.trim(),
    };
    const dup = models.some(m => m.id !== modelForm.id && m.brand.toLowerCase() === data.brand.toLowerCase() && m.model.toLowerCase() === data.model.toLowerCase());
    if (dup) return toast(`${data.brand} ${data.model} sudah ada.`, 'error');
    const ok = await run(
      () => modelForm.id
        ? updateDoc(doc(db, 'device_models', modelForm.id), { ...data, updatedAt: serverTimestamp() })
        : addDoc(collection(db, 'device_models'), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      modelForm.id ? 'Model diperbarui.' : `${data.brand} ${data.model} ditambahkan.`,
    );
    if (ok) setModelForm(null);
  }

  async function removeSupplier(s: Supplier) {
    const count = usage.bySupplier.get(s.id) || 0;
    const ok = await confirm({
      title: 'Hapus supplier?', danger: true, confirmLabel: 'Ya, Hapus',
      message: <>Supplier <b>{s.name}</b> dihapus.{count > 0 && <> {count} unit tetap menyimpan nama supplier ini di data pengadaannya.</>}</>,
    });
    if (ok) run(() => deleteDoc(doc(db, 'suppliers', s.id)), 'Supplier dihapus.');
  }

  async function removeModel(m: DeviceModel) {
    const ok = await confirm({
      title: 'Hapus model?', danger: true, confirmLabel: 'Ya, Hapus',
      message: <><b>{m.brand} {m.model}</b> dihapus dari daftar pilihan. Unit yang sudah terdaftar tidak berubah.</>,
    });
    if (ok) run(() => deleteDoc(doc(db, 'device_models', m.id)), 'Model dihapus.');
  }

  const filteredSuppliers = suppliers.filter(s => matchesSearch(search, s.name, s.contactName, s.phone, s.email));
  const filteredModels = models.filter(m => matchesSearch(search, m.brand, m.model, m.category));

  return (
    <div className="space-y-6">
      <PageHeader icon={Truck} title="Supplier & Model" subtitle="Vendor / distributor EDC dan daftar brand & tipe perangkat">
        {canWrite && (
          tab === 'suppliers'
            ? <button onClick={() => setSupplierForm({ data: emptySupplier })} className={btnPrimary}><Plus size={16} /> Tambah Supplier</button>
            : <button onClick={() => setModelForm({ data: emptyModel })} className={btnPrimary}><Plus size={16} /> Tambah Model</button>
        )}
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex bg-white rounded-xl border border-brand-border p-1 gap-1">
          {([['suppliers', `Supplier (${suppliers.length})`, Truck], ['models', `Model Perangkat (${models.length})`, Cpu]] as const).map(([id, label, Icon]) => (
            <button
              key={id} onClick={() => setTab(id)} aria-pressed={tab === id}
              className={cn('px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider flex items-center gap-2', tab === id ? 'bg-brand-primary text-white' : 'text-brand-text-muted hover:bg-gray-50')}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted" size={16} />
          <input type="search" aria-label="Cari" className={cn(inputClass, 'pl-10 bg-white')} placeholder={tab === 'suppliers' ? 'Cari nama supplier, kontak...' : 'Cari brand, tipe, kategori...'} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
        {tab === 'suppliers' ? (
          filteredSuppliers.length === 0 ? (
            <EmptyState icon={Truck} title={suppliers.length === 0 ? 'Belum ada supplier' : 'Tidak ada supplier yang cocok'} hint={suppliers.length === 0 ? 'Supplier dipilih saat menerima unit dari vendor (registrasi / import aset).' : undefined} />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-[#F8FAFC] text-[11px] font-bold text-brand-text-muted uppercase tracking-wider">
                  <th className="px-5 py-3 border-b border-brand-border">Supplier</th>
                  <th className="px-5 py-3 border-b border-brand-border">Kontak</th>
                  <th className="px-5 py-3 border-b border-brand-border text-right">Unit Diterima</th>
                  {canWrite && <th className="px-5 py-3 border-b border-brand-border text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {filteredSuppliers.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <span className="font-bold text-brand-text-main">{s.name}</span>
                      {s.address && <span className="block text-[11px] text-brand-text-muted">{s.address}</span>}
                    </td>
                    <td className="px-5 py-3 text-xs text-brand-text-main">
                      {[s.contactName, s.phone, s.email].filter(Boolean).join(' · ') || '-'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => go('inventory', { supplier: s.id })} className="font-black text-brand-primary hover:underline">{usage.bySupplier.get(s.id) || 0}</button>
                    </td>
                    {canWrite && (
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => setSupplierForm({ id: s.id, data: { ...emptySupplier, ...Object.fromEntries(Object.entries(s).filter(([k]) => k in emptySupplier)) } as typeof emptySupplier })} aria-label={`Edit ${s.name}`} className="p-1.5 text-brand-text-muted hover:text-brand-primary border border-brand-border rounded"><Edit2 size={14} /></button>
                          {can('delete') && <button onClick={() => removeSupplier(s)} aria-label={`Hapus ${s.name}`} className="p-1.5 text-brand-text-muted hover:text-red-600 border border-brand-border rounded"><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : filteredModels.length === 0 ? (
          <EmptyState icon={Cpu} title={models.length === 0 ? 'Belum ada model perangkat' : 'Tidak ada model yang cocok'} hint={models.length === 0 ? 'Model muncul sebagai pilihan saat registrasi, dan masa garansinya dipakai untuk menghitung tanggal garansi otomatis.' : undefined} />
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-[#F8FAFC] text-[11px] font-bold text-brand-text-muted uppercase tracking-wider">
                <th className="px-5 py-3 border-b border-brand-border">Brand / Tipe</th>
                <th className="px-5 py-3 border-b border-brand-border">Kategori</th>
                <th className="px-5 py-3 border-b border-brand-border text-right">Garansi</th>
                <th className="px-5 py-3 border-b border-brand-border text-right">Jumlah Unit</th>
                {canWrite && <th className="px-5 py-3 border-b border-brand-border text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {filteredModels.map(m => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <span className="font-black text-brand-text-main">{m.brand}</span> <span className="font-bold text-brand-text-main">{m.model}</span>
                    {m.notes && <span className="block text-[11px] text-brand-text-muted">{m.notes}</span>}
                  </td>
                  <td className="px-5 py-3 text-xs text-brand-text-main">{m.category || '-'}</td>
                  <td className="px-5 py-3 text-right text-xs font-bold">{m.warrantyMonths ? `${m.warrantyMonths} bln` : '-'}</td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => go('inventory', { q: m.model })} className="font-black text-brand-primary hover:underline">{usage.modelCount(m)}</button>
                  </td>
                  {canWrite && (
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => setModelForm({ id: m.id, data: { brand: m.brand, model: m.model, category: m.category || 'Lainnya', warrantyMonths: String(m.warrantyMonths ?? ''), notes: m.notes || '' } })} aria-label={`Edit ${m.brand} ${m.model}`} className="p-1.5 text-brand-text-muted hover:text-brand-primary border border-brand-border rounded"><Edit2 size={14} /></button>
                        {can('delete') && <button onClick={() => removeModel(m)} aria-label={`Hapus ${m.brand} ${m.model}`} className="p-1.5 text-brand-text-muted hover:text-red-600 border border-brand-border rounded"><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!supplierForm} onClose={() => setSupplierForm(null)} busy={busy} title={supplierForm?.id ? 'Edit Supplier' : 'Tambah Supplier'}>
        {supplierForm && (
          <form onSubmit={saveSupplier} className="p-6 grid grid-cols-2 gap-4">
            <Field label="Nama Supplier / Vendor" className="col-span-2"><input required maxLength={200} className={inputClass} value={supplierForm.data.name} onChange={e => setSupplierForm({ ...supplierForm, data: { ...supplierForm.data, name: e.target.value } })} /></Field>
            <Field label="Nama Kontak"><input maxLength={200} className={inputClass} value={supplierForm.data.contactName} onChange={e => setSupplierForm({ ...supplierForm, data: { ...supplierForm.data, contactName: e.target.value } })} /></Field>
            <Field label="Telepon"><input maxLength={64} className={inputClass} value={supplierForm.data.phone} onChange={e => setSupplierForm({ ...supplierForm, data: { ...supplierForm.data, phone: e.target.value } })} /></Field>
            <Field label="Email" className="col-span-2"><input type="email" maxLength={128} className={inputClass} value={supplierForm.data.email} onChange={e => setSupplierForm({ ...supplierForm, data: { ...supplierForm.data, email: e.target.value } })} /></Field>
            <Field label="Alamat" className="col-span-2"><textarea maxLength={500} className={cn(inputClass, 'min-h-[60px]')} value={supplierForm.data.address} onChange={e => setSupplierForm({ ...supplierForm, data: { ...supplierForm.data, address: e.target.value } })} /></Field>
            <Field label="Catatan" className="col-span-2" hint="Mis. brand yang dipasok, SLA garansi, termin pembayaran."><textarea maxLength={500} className={cn(inputClass, 'min-h-[60px]')} value={supplierForm.data.notes} onChange={e => setSupplierForm({ ...supplierForm, data: { ...supplierForm.data, notes: e.target.value } })} /></Field>
            <div className="col-span-2 flex gap-3 pt-2">
              <button type="button" disabled={busy} onClick={() => setSupplierForm(null)} className={cn(btnSecondary, 'flex-1 py-3')}>Batal</button>
              <button type="submit" disabled={busy} className={cn(btnPrimary, 'flex-1 py-3')}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!modelForm} onClose={() => setModelForm(null)} busy={busy} title={modelForm?.id ? 'Edit Model' : 'Tambah Model Perangkat'}>
        {modelForm && (
          <form onSubmit={saveModel} className="p-6 grid grid-cols-2 gap-4">
            <Field label="Brand / Merk" hint="Mis. PAX, INGENICO, VERIFONE, SUNMI.">
              <input required maxLength={100} list="brand-options" className={inputClass} value={modelForm.data.brand} onChange={e => setModelForm({ ...modelForm, data: { ...modelForm.data, brand: e.target.value } })} />
            </Field>
            <datalist id="brand-options">{Array.from(new Set(models.map(m => m.brand))).map(b => <option key={b} value={b} />)}</datalist>
            <Field label="Tipe / Model" hint="Mis. A920 Pro, Move/5000.">
              <input required maxLength={100} className={inputClass} value={modelForm.data.model} onChange={e => setModelForm({ ...modelForm, data: { ...modelForm.data, model: e.target.value } })} />
            </Field>
            <Field label="Kategori">
              <select className={inputClass} value={modelForm.data.category} onChange={e => setModelForm({ ...modelForm, data: { ...modelForm.data, category: e.target.value } })}>
                {DEVICE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Garansi Default (bulan)" hint="Dipakai untuk tanggal garansi otomatis saat penerimaan.">
              <input type="number" min={0} max={120} className={inputClass} value={modelForm.data.warrantyMonths} onChange={e => setModelForm({ ...modelForm, data: { ...modelForm.data, warrantyMonths: e.target.value } })} />
            </Field>
            <Field label="Catatan" className="col-span-2"><textarea maxLength={500} className={cn(inputClass, 'min-h-[60px]')} value={modelForm.data.notes} onChange={e => setModelForm({ ...modelForm, data: { ...modelForm.data, notes: e.target.value } })} /></Field>
            <div className="col-span-2 flex gap-3 pt-2">
              <button type="button" disabled={busy} onClick={() => setModelForm(null)} className={cn(btnSecondary, 'flex-1 py-3')}>Batal</button>
              <button type="submit" disabled={busy} className={cn(btnPrimary, 'flex-1 py-3')}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
