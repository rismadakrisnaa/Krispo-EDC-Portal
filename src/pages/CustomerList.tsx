import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { Download, Edit2, FileUp, Mail, MapPin, Plus, Search, ShieldAlert, Smartphone, Trash2, Users } from 'lucide-react';
import { db, describeError } from '../lib/firebase';
import { CONTRACT_STATUS, CUSTOMER_CATEGORIES, DEFAULT_CONTRACT_MONTHS, SCHEMES, STATUS } from '../lib/constants';
import { cell, readExcel, writeExcel } from '../lib/excel';
import { chunk, cn, formatIDR, matchesSearch, toNumber } from '../lib/utils';
import type { Customer } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useNav } from '../context/NavContext';
import { EmptyState, Field, FileDrop, Modal, PageHeader, btnPrimary, btnSecondary, inputClass, useFeedback } from '../components/ui';

const emptyForm = { name: '', email: '', category: 'Retail', picName: '', contact: '', address: '', scheme: 'Sewa', value: '', contractDuration: String(DEFAULT_CONTRACT_MONTHS) };
type Form = typeof emptyForm;

const toPayload = (form: Form) => ({
  name: form.name.trim(), email: form.email.trim(), category: form.category, picName: form.picName.trim(),
  contact: form.contact.trim(), address: form.address.trim(), scheme: form.scheme,
  // Selalu disimpan sebagai angka, bukan string dari input.
  value: toNumber(form.value), contractDuration: Math.round(toNumber(form.contractDuration, DEFAULT_CONTRACT_MONTHS)) || DEFAULT_CONTRACT_MONTHS,
});

export function CustomerList() {
  const { customers, assets } = useData();
  const { can } = useAuth();
  const { params, go } = useNav();
  const { toast, confirm } = useFeedback();
  const canWrite = can('customers.write');

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSearch(params.q || ''), [params]);

  // Jumlah unit per customer dihitung dari data aset yang sama dengan menu Aset.
  const unitStats = useMemo(() => {
    const stats = new Map<string, { held: number; installed: number; activeContracts: number }>();
    const get = (id: string) => stats.get(id) || stats.set(id, { held: 0, installed: 0, activeContracts: 0 }).get(id)!;
    for (const a of assets) {
      if (a.assetType !== 'perangkat') continue;
      if (a.currentCustomerId) {
        get(a.currentCustomerId).held++;
        if (a.status === STATUS.INSTALLED) get(a.currentCustomerId).installed++;
      }
      if (a.contractCustomerId && a.contractStatus === CONTRACT_STATUS.ACTIVE) get(a.contractCustomerId).activeContracts++;
    }
    return stats;
  }, [assets]);

  const filtered = customers.filter(c => matchesSearch(search, c.name, c.picName, c.email, c.category, c.address));
  const set = (field: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => prev && { ...prev, [field]: e.target.value });

  const openAdd = () => { setEditing(null); setForm(emptyForm); };
  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({
      name: c.name || '', email: c.email || '', category: c.category || 'Retail', picName: c.picName || '', contact: c.contact || '',
      address: c.address || '', scheme: c.scheme || 'Sewa', value: String(c.value ?? ''), contractDuration: String(c.contractDuration ?? DEFAULT_CONTRACT_MONTHS),
    });
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const payload = toPayload(form);
    if (customers.some(c => c.id !== editing?.id && c.name.trim().toLowerCase() === payload.name.toLowerCase())) {
      return toast(`Customer "${payload.name}" sudah terdaftar.`, 'error');
    }
    setBusy(true);
    try {
      if (editing) await updateDoc(doc(db, 'customers', editing.id), { ...payload, updatedAt: serverTimestamp() });
      else await addDoc(collection(db, 'customers'), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      toast(editing ? 'Data customer diperbarui.' : `Customer ${payload.name} ditambahkan.`);
      setForm(null);
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(c: Customer) {
    const stats = unitStats.get(c.id);
    if (stats && (stats.held > 0 || stats.activeContracts > 0)) {
      return toast(`${c.name} masih memegang ${stats.held} unit / ${stats.activeContracts} kontrak aktif. Tarik unitnya dulu lewat menu Pergerakan.`, 'error');
    }
    const ok = await confirm({ title: 'Hapus customer?', danger: true, confirmLabel: 'Ya, Hapus', message: <>Customer <b>{c.name}</b> akan dihapus permanen. Riwayat pergerakan & kontrak lama tetap menyimpan namanya.</> });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'customers', c.id));
      toast(`${c.name} dihapus.`);
    } catch (error) {
      toast(describeError(error), 'error');
    }
  }

  async function handleImport(file: File) {
    setBusy(true);
    try {
      const rows = await readExcel(file);
      const known = new Set(customers.map(c => c.name.trim().toLowerCase()));
      const payloads: ReturnType<typeof toPayload>[] = [];
      let skipped = 0;
      for (const row of rows) {
        const name = cell(row, 'Customer Name', 'Nama Customer', 'Nama');
        if (!name || known.has(name.toLowerCase())) { if (name) skipped++; continue; }
        known.add(name.toLowerCase());
        payloads.push(toPayload({
          name, email: cell(row, 'Email'),
          category: CUSTOMER_CATEGORIES.find(c => c.toLowerCase() === cell(row, 'Category', 'Kategori').toLowerCase()) || 'Retail',
          picName: cell(row, 'PIC Name', 'PIC'), contact: cell(row, 'Contact Number', 'Kontak'), address: cell(row, 'Address', 'Alamat'),
          scheme: SCHEMES.find(s => s.toLowerCase() === cell(row, 'Scheme', 'Skema').toLowerCase()) || 'Sewa',
          // Kolom ini dulu ada di template tapi tidak ikut diimpor, sehingga kontrak & denda jadi Rp 0.
          value: cell(row, 'Value', 'Nilai Sewa'), contractDuration: cell(row, 'Duration', 'Durasi') || String(DEFAULT_CONTRACT_MONTHS),
        }));
      }
      for (const group of chunk(payloads, 400)) {
        const batch = writeBatch(db);
        group.forEach(p => batch.set(doc(collection(db, 'customers')), { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
        await batch.commit();
      }
      toast(`${payloads.length} customer diimpor.${skipped ? ` ${skipped} dilewati (nama sudah ada).` : ''}`, payloads.length ? 'success' : 'info');
      setShowImport(false);
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  const template = [{ 'Customer Name': 'PT Contoh Sejahtera', Email: 'pic@contoh.co.id', Category: 'Enterprise', 'PIC Name': 'Budi Santoso', 'Contact Number': '08123456789', Address: 'BSD City, Tangerang', Scheme: 'Sewa', Value: 150000, Duration: 24 }];
  const handleExport = () => writeExcel(customers.map(c => ({
    'Customer Name': c.name, Email: c.email, Category: c.category || '', 'PIC Name': c.picName || '', 'Contact Number': c.contact || '', Address: c.address || '',
    Scheme: c.scheme || '', Value: c.value || 0, Duration: c.contractDuration || 0,
    'Unit Dipegang': unitStats.get(c.id)?.held || 0, 'Unit Terpasang': unitStats.get(c.id)?.installed || 0,
  })), 'Customers', 'Master_Customer.xlsx').catch(error => toast(describeError(error), 'error'));

  return (
    <div className="space-y-6">
      <PageHeader icon={Users} title="Customer B2B" subtitle="Master pelanggan & ketentuan kontrak default">
        <button onClick={handleExport} className={btnSecondary}><Download size={16} /> Export</button>
        {canWrite && (
          <>
            <button onClick={() => setShowImport(true)} className={btnSecondary}><FileUp size={16} /> Import</button>
            <button onClick={openAdd} className={btnPrimary}><Plus size={16} /> Tambah Customer</button>
          </>
        )}
      </PageHeader>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted" size={16} />
        <input type="search" aria-label="Cari customer" className={cn(inputClass, 'pl-10 bg-white')} placeholder="Cari nama, PIC, email, alamat..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-brand-border">
          <EmptyState icon={Users} title={customers.length === 0 ? 'Belum ada customer' : 'Tidak ada customer yang cocok'} hint={customers.length === 0 ? 'Customer dibutuhkan sebelum unit bisa dialokasikan / dipasang.' : undefined} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(c => {
            const stats = unitStats.get(c.id) || { held: 0, installed: 0, activeContracts: 0 };
            return (
              <div key={c.id} className="bg-white p-5 rounded-2xl border border-brand-border hover:border-brand-primary transition-all flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 bg-brand-primary rounded-xl flex items-center justify-center text-white font-black text-lg shrink-0">{(c.name || '?').charAt(0).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-brand-text-main leading-tight break-words">{c.name}</h3>
                    <span className="text-[10px] font-bold text-white bg-brand-primary px-2 py-0.5 rounded uppercase tracking-widest">{c.category || 'Retail'}</span>
                  </div>
                  {canWrite && <button onClick={() => openEdit(c)} aria-label={`Edit ${c.name}`} className="p-1.5 text-brand-text-muted hover:text-brand-primary border border-brand-border rounded-lg"><Edit2 size={14} /></button>}
                  {can('delete') && <button onClick={() => handleDelete(c)} aria-label={`Hapus ${c.name}`} className="p-1.5 text-brand-text-muted hover:text-red-600 border border-brand-border rounded-lg"><Trash2 size={14} /></button>}
                </div>

                <div className="space-y-2 text-xs font-medium text-brand-text-main">
                  <p className="flex items-start gap-2"><Users size={13} className="text-brand-text-muted mt-0.5 shrink-0" />{c.picName || '-'}{c.contact ? ` (${c.contact})` : ''}</p>
                  <p className="flex items-start gap-2 break-all"><Mail size={13} className="text-brand-text-muted mt-0.5 shrink-0" />{c.email || '-'}</p>
                  <p className="flex items-start gap-2"><MapPin size={13} className="text-brand-text-muted mt-0.5 shrink-0" />{c.address || '-'}</p>
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-brand-border pt-3 text-center">
                  <div><p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Skema</p><p className="text-xs font-bold text-brand-primary">{c.scheme || 'Sewa'}</p></div>
                  <div><p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Durasi</p><p className="text-xs font-bold text-brand-text-main">{c.contractDuration || DEFAULT_CONTRACT_MONTHS} bln</p></div>
                  <div><p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Sewa / Unit</p><p className={cn('text-xs font-black', Number(c.value) > 0 ? 'text-brand-text-main' : 'text-red-600')}>{formatIDR(c.value)}</p></div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-auto">
                  <button onClick={() => go('inventory', { customer: c.id })} className="py-2 bg-brand-primary-light text-brand-primary rounded-xl text-[10px] font-bold uppercase tracking-wide hover:bg-brand-primary hover:text-white transition-all flex items-center justify-center gap-1.5">
                    <Smartphone size={12} /> Aset ({stats.held})
                  </button>
                  <button onClick={() => go('contracts', { customer: c.id })} className="py-2 bg-gray-50 text-brand-text-muted rounded-xl text-[10px] font-bold uppercase tracking-wide hover:bg-gray-100 border border-brand-border flex items-center justify-center gap-1.5">
                    <ShieldAlert size={12} /> Kontrak ({stats.activeContracts})
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} busy={busy} title={editing ? 'Edit Customer' : 'Tambah Customer'} subtitle={editing?.name}>
        {form && (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Nama Customer" className="col-span-2"><input required maxLength={200} className={inputClass} value={form.name} onChange={set('name')} /></Field>
              <Field label="Kategori">
                <select className={inputClass} value={form.category} onChange={set('category')}>{CUSTOMER_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
              </Field>
              <Field label="Email"><input required type="email" maxLength={128} className={inputClass} value={form.email} onChange={set('email')} /></Field>
              <Field label="Nama PIC"><input required className={inputClass} value={form.picName} onChange={set('picName')} /></Field>
              <Field label="No. Kontak"><input required className={inputClass} value={form.contact} onChange={set('contact')} /></Field>
              <Field label="Alamat" className="col-span-2"><textarea required maxLength={500} className={cn(inputClass, 'min-h-[70px]')} value={form.address} onChange={set('address')} /></Field>
              <Field label="Skema Bisnis">
                <select className={inputClass} value={form.scheme} onChange={set('scheme')}>{SCHEMES.map(s => <option key={s}>{s}</option>)}</select>
              </Field>
              <Field label="Durasi Kontrak (bulan)"><input required type="number" min={1} max={120} className={inputClass} value={form.contractDuration} onChange={set('contractDuration')} /></Field>
              <Field label="Sewa per Unit per Bulan (IDR)" className="col-span-2" hint="Dipakai untuk menghitung kontrak & denda saat unit di-Install. Perubahan hanya berlaku untuk pemasangan berikutnya; kontrak yang sudah berjalan tidak berubah.">
                <input required type="number" min={0} className={inputClass} value={form.value} onChange={set('value')} />
              </Field>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" disabled={busy} onClick={() => setForm(null)} className={cn(btnSecondary, 'flex-1 py-3')}>Batal</button>
              <button type="submit" disabled={busy} className={cn(btnPrimary, 'flex-1 py-3')}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={showImport} onClose={() => setShowImport(false)} busy={busy} title="Import Customer" subtitle="Bulk import dari Excel">
        <div className="p-6 space-y-5">
          <button onClick={() => writeExcel(template, 'Template', 'Template_Import_Customer.xlsx')} className="flex items-center gap-2 text-xs font-bold text-brand-primary hover:underline"><Download size={14} /> Unduh Template</button>
          <FileDrop busy={busy} onFile={handleImport} />
          <p className="text-[11px] text-brand-text-muted">Customer dengan nama yang sudah terdaftar otomatis dilewati.</p>
        </div>
      </Modal>
    </div>
  );
}
