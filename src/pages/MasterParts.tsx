import React, { useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Edit2, Package, Plus, Search, Settings, Trash2 } from 'lucide-react';
import { db, describeError } from '../lib/firebase';
import { cn, formatIDR, matchesSearch, toNumber } from '../lib/utils';
import type { Part } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { EmptyState, Field, Modal, PageHeader, btnPrimary, btnSecondary, inputClass, useFeedback } from '../components/ui';

const emptyForm = { name: '', price: '', description: '' };

export function MasterParts() {
  const { parts } = useData();
  const { can } = useAuth();
  const { toast, confirm } = useFeedback();
  const canWrite = can('parts.write');

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Part | null>(null);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = parts.filter(p => matchesSearch(search, p.name, p.description));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    // Harga selalu disimpan sebagai angka supaya penjumlahan denda tidak salah.
    const payload = { name: form.name.trim(), price: toNumber(form.price), description: form.description.trim() };
    if (parts.some(p => p.id !== editing?.id && p.name.trim().toLowerCase() === payload.name.toLowerCase())) return toast(`Part "${payload.name}" sudah ada.`, 'error');
    setBusy(true);
    try {
      if (editing) await updateDoc(doc(db, 'edc_parts', editing.id), { ...payload, updatedAt: serverTimestamp() });
      else await addDoc(collection(db, 'edc_parts'), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      toast(editing ? 'Part diperbarui.' : `Part ${payload.name} ditambahkan.`);
      setForm(null);
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(part: Part) {
    const ok = await confirm({
      title: 'Hapus part?', danger: true, confirmLabel: 'Ya, Hapus',
      message: <>Part <b>{part.name}</b> dihapus dari checklist penarikan. Denda yang sudah tercatat sebelumnya tidak berubah.</>,
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'edc_parts', part.id));
      toast(`${part.name} dihapus.`);
    } catch (error) {
      toast(describeError(error), 'error');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={Settings} title="Part EDC" subtitle="Daftar komponen & biaya penggantian untuk checklist penarikan">
        {canWrite && <button onClick={() => { setEditing(null); setForm(emptyForm); }} className={btnPrimary}><Plus size={16} /> Tambah Part</button>}
      </PageHeader>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted" size={16} />
        <input type="search" aria-label="Cari part" className={cn(inputClass, 'pl-10 bg-white')} placeholder="Cari nama part..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={Package} title={parts.length === 0 ? 'Belum ada part' : 'Tidak ada part yang cocok'} hint={parts.length === 0 ? 'Part di sini muncul sebagai checklist hilang / rusak saat unit ditarik (Withdrawal).' : undefined} />
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#F8FAFC] text-[11px] font-bold text-brand-text-muted uppercase tracking-wider">
                <th className="px-5 py-3 border-b border-brand-border">Nama Part</th>
                <th className="px-5 py-3 border-b border-brand-border">Deskripsi</th>
                <th className="px-5 py-3 border-b border-brand-border text-right">Biaya Penggantian</th>
                {(canWrite || can('delete')) && <th className="px-5 py-3 border-b border-brand-border text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border text-sm">
              {filtered.map(part => (
                <tr key={part.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-bold text-brand-text-main">{part.name}</td>
                  <td className="px-5 py-3 text-xs text-brand-text-muted">{part.description || '-'}</td>
                  <td className="px-5 py-3 text-right font-black text-brand-text-main whitespace-nowrap">{formatIDR(part.price)}</td>
                  {(canWrite || can('delete')) && (
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        {canWrite && (
                          <button onClick={() => { setEditing(part); setForm({ name: part.name || '', price: String(part.price ?? ''), description: part.description || '' }); }} aria-label={`Edit ${part.name}`} className="p-1.5 text-brand-text-muted hover:text-brand-primary border border-brand-border rounded"><Edit2 size={14} /></button>
                        )}
                        {can('delete') && <button onClick={() => handleDelete(part)} aria-label={`Hapus ${part.name}`} className="p-1.5 text-brand-text-muted hover:text-red-600 border border-brand-border rounded"><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} busy={busy} title={editing ? 'Edit Part' : 'Tambah Part'} subtitle={editing?.name}>
        {form && (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <Field label="Nama Part / Komponen"><input required maxLength={100} className={inputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Biaya Penggantian (IDR)" hint="Perubahan harga hanya berlaku untuk penarikan berikutnya.">
              <input required type="number" min={0} className={inputClass} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
            </Field>
            <Field label="Deskripsi"><textarea maxLength={500} className={cn(inputClass, 'min-h-[70px]')} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="flex gap-3 pt-2">
              <button type="button" disabled={busy} onClick={() => setForm(null)} className={cn(btnSecondary, 'flex-1 py-3')}>Batal</button>
              <button type="submit" disabled={busy} className={cn(btnPrimary, 'flex-1 py-3')}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
