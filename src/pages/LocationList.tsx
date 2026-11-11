import React, { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { Download, Edit2, FileUp, MapPin, Plus, Search, Store, Trash2, Warehouse, Wrench } from 'lucide-react';
import { db, describeError } from '../lib/firebase';
import { LOCATION_TYPES } from '../lib/constants';
import { cell, readExcel, writeExcel } from '../lib/excel';
import { chunk, cn, matchesSearch } from '../lib/utils';
import type { Location } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useNav } from '../context/NavContext';
import { EmptyState, Field, FileDrop, Modal, PageHeader, btnPrimary, btnSecondary, inputClass, useFeedback } from '../components/ui';

const ICONS: Record<string, React.ElementType> = { Warehouse, 'Merchant Site': Store, 'Service Center': Wrench };
const TYPE_HINT: Record<string, string> = {
  Warehouse: 'Tujuan saat unit ditarik / kembali ke stok.',
  'Merchant Site': 'Tujuan saat unit dikirim, dipasang, atau direlokasi.',
  'Service Center': 'Tujuan saat unit dikirim untuk perbaikan.',
};
const emptyForm = { name: '', type: 'Warehouse', address: '', customerId: '' };

export function LocationList() {
  const { locations, customers, customerById, assets } = useData();
  const { can } = useAuth();
  const { go } = useNav();
  const { toast, confirm } = useFeedback();
  const canWrite = can('locations.write');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);

  // Jumlah aset di tiap lokasi, dari data aset yang sama dengan menu Aset.
  const unitCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets) if (a.currentLocationId) counts.set(a.currentLocationId, (counts.get(a.currentLocationId) || 0) + 1);
    return counts;
  }, [assets]);

  const filtered = locations.filter(l => (typeFilter === 'All' || l.type === typeFilter) && matchesSearch(search, l.name, l.type, l.address, l.customerId && customerById.get(l.customerId)?.name));

  const payloadOf = (f: typeof emptyForm) => ({
    name: f.name.trim(), type: f.type, address: f.address.trim(),
    customerId: f.type === 'Merchant Site' && f.customerId ? f.customerId : null,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const payload = payloadOf(form);
    if (locations.some(l => l.id !== editing?.id && l.name.trim().toLowerCase() === payload.name.toLowerCase())) return toast(`Lokasi "${payload.name}" sudah ada.`, 'error');
    setBusy(true);
    try {
      if (editing) await updateDoc(doc(db, 'locations', editing.id), { ...payload, updatedAt: serverTimestamp() });
      else await addDoc(collection(db, 'locations'), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      toast(editing ? 'Lokasi diperbarui.' : `Lokasi ${payload.name} ditambahkan.`);
      setForm(null);
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(l: Location) {
    const count = unitCount.get(l.id) || 0;
    if (count > 0) return toast(`Masih ada ${count} aset di ${l.name}. Pindahkan dulu lewat menu Pergerakan.`, 'error');
    if (!(await confirm({ title: 'Hapus lokasi?', danger: true, confirmLabel: 'Ya, Hapus', message: <>Lokasi <b>{l.name}</b> akan dihapus permanen.</> }))) return;
    try {
      await deleteDoc(doc(db, 'locations', l.id));
      toast(`${l.name} dihapus.`);
    } catch (error) {
      toast(describeError(error), 'error');
    }
  }

  async function handleImport(file: File) {
    setBusy(true);
    try {
      const rows = await readExcel(file);
      const known = new Set(locations.map(l => l.name.trim().toLowerCase()));
      const customerByName = new Map(customers.map(c => [c.name.trim().toLowerCase(), c.id]));
      const payloads: ReturnType<typeof payloadOf>[] = [];
      let skipped = 0;
      for (const row of rows) {
        const name = cell(row, 'Location Name', 'Nama Lokasi', 'Nama');
        if (!name || known.has(name.toLowerCase())) { if (name) skipped++; continue; }
        known.add(name.toLowerCase());
        payloads.push(payloadOf({
          name, address: cell(row, 'Address', 'Alamat'),
          type: LOCATION_TYPES.find(t => t.toLowerCase() === cell(row, 'Type', 'Tipe').toLowerCase()) || 'Warehouse',
          customerId: customerByName.get(cell(row, 'Customer').toLowerCase()) || '',
        }));
      }
      for (const group of chunk(payloads, 400)) {
        const batch = writeBatch(db);
        group.forEach(p => batch.set(doc(collection(db, 'locations')), { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
        await batch.commit();
      }
      toast(`${payloads.length} lokasi diimpor.${skipped ? ` ${skipped} dilewati (nama sudah ada).` : ''}`, payloads.length ? 'success' : 'info');
      setShowImport(false);
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  const template = [{ 'Location Name': 'Gudang Utama Jakarta', Type: 'Warehouse', Address: 'Jl. Contoh No. 1, Jakarta', Customer: '' }];
  const handleExport = () => writeExcel(locations.map(l => ({
    'Location Name': l.name, Type: l.type, Address: l.address || '', Customer: (l.customerId && customerById.get(l.customerId)?.name) || '', 'Jumlah Aset': unitCount.get(l.id) || 0,
  })), 'Locations', 'Master_Lokasi.xlsx').catch(error => toast(describeError(error), 'error'));

  return (
    <div className="space-y-6">
      <PageHeader icon={MapPin} title="Lokasi" subtitle="Gudang, titik merchant, dan service center">
        <button onClick={handleExport} className={btnSecondary}><Download size={16} /> Export</button>
        {canWrite && (
          <>
            <button onClick={() => setShowImport(true)} className={btnSecondary}><FileUp size={16} /> Import</button>
            <button onClick={() => { setEditing(null); setForm(emptyForm); }} className={btnPrimary}><Plus size={16} /> Tambah Lokasi</button>
          </>
        )}
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted" size={16} />
          <input type="search" aria-label="Cari lokasi" className={cn(inputClass, 'pl-10 bg-white')} placeholder="Cari nama, alamat, customer..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select aria-label="Filter tipe" className={cn(inputClass, 'bg-white sm:w-52')} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="All">Semua tipe</option>
          {LOCATION_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-brand-border">
          <EmptyState icon={MapPin} title={locations.length === 0 ? 'Belum ada lokasi' : 'Tidak ada lokasi yang cocok'} hint={locations.length === 0 ? 'Tambahkan minimal satu gudang supaya posisi unit bisa dilacak.' : undefined} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(l => {
            const Icon = ICONS[l.type] || MapPin;
            const count = unitCount.get(l.id) || 0;
            const owner = l.customerId ? customerById.get(l.customerId) : undefined;
            return (
              <div key={l.id} className="bg-white p-4 rounded-xl border border-brand-border hover:border-brand-primary transition-all flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-brand-primary-light text-brand-primary rounded-lg flex items-center justify-center shrink-0"><Icon size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-brand-text-main text-sm break-words">{l.name}</h3>
                    <p className="text-[10px] font-bold text-brand-primary uppercase tracking-widest">{l.type}{owner ? ` · ${owner.name}` : ''}</p>
                  </div>
                  {canWrite && (
                    <button onClick={() => { setEditing(l); setForm({ name: l.name || '', type: (LOCATION_TYPES as string[]).includes(l.type) ? l.type : 'Warehouse', address: l.address || '', customerId: l.customerId || '' }); }} aria-label={`Edit ${l.name}`} className="p-1.5 text-brand-text-muted hover:text-brand-primary border border-brand-border rounded"><Edit2 size={13} /></button>
                  )}
                  {can('delete') && <button onClick={() => handleDelete(l)} aria-label={`Hapus ${l.name}`} className="p-1.5 text-brand-text-muted hover:text-red-600 border border-brand-border rounded"><Trash2 size={13} /></button>}
                </div>
                <p className="text-xs text-brand-text-muted leading-relaxed">{l.address || '-'}</p>
                <button onClick={() => go('inventory', { q: l.name })} className="mt-auto text-left text-[11px] font-bold text-brand-primary hover:underline">{count} aset di lokasi ini →</button>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} busy={busy} title={editing ? 'Edit Lokasi' : 'Tambah Lokasi'} subtitle={editing?.name}>
        {form && (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <Field label="Nama Lokasi"><input required maxLength={200} className={inputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Tipe" hint={TYPE_HINT[form.type]}>
              <select className={inputClass} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{LOCATION_TYPES.map(t => <option key={t}>{t}</option>)}</select>
            </Field>
            {form.type === 'Merchant Site' && (
              <Field label="Milik Customer" hint="Lokasi ini hanya muncul sebagai pilihan saat memproses unit untuk customer tersebut.">
                <select className={inputClass} value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })}>
                  <option value="">Umum (semua customer)</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Alamat Lengkap"><textarea required maxLength={500} className={cn(inputClass, 'min-h-[80px]')} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></Field>
            <div className="flex gap-3 pt-2">
              <button type="button" disabled={busy} onClick={() => setForm(null)} className={cn(btnSecondary, 'flex-1 py-3')}>Batal</button>
              <button type="submit" disabled={busy} className={cn(btnPrimary, 'flex-1 py-3')}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={showImport} onClose={() => setShowImport(false)} busy={busy} title="Import Lokasi" subtitle="Bulk import dari Excel">
        <div className="p-6 space-y-5">
          <button onClick={() => writeExcel(template, 'Template', 'Template_Import_Lokasi.xlsx')} className="flex items-center gap-2 text-xs font-bold text-brand-primary hover:underline"><Download size={14} /> Unduh Template</button>
          <FileDrop busy={busy} onFile={handleImport} />
        </div>
      </Modal>
    </div>
  );
}
