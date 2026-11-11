import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { Download, Edit2, ExternalLink, FileUp, MapPin, Phone, Plus, Search, Store, Trash2, Warehouse, Wrench } from 'lucide-react';
import { db, describeError } from '../lib/firebase';
import { LOCATION_TYPES, LOCATION_TYPE_LABEL } from '../lib/constants';
import { cell, readExcel, writeExcel } from '../lib/excel';
import { chunk, cn, mapsUrl, matchesSearch } from '../lib/utils';
import type { Location } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useNav } from '../context/NavContext';
import { EmptyState, Field, FileDrop, Modal, PageHeader, btnPrimary, btnSecondary, inputClass, useFeedback } from '../components/ui';

const ICONS: Record<string, React.ElementType> = { Warehouse, 'Merchant Site': Store, 'Service Center': Wrench };
const TYPE_HINT: Record<string, string> = {
  Warehouse: 'Tujuan saat unit diterima, ditarik, kembali ke stok, atau dimutasi.',
  'Merchant Site': 'Outlet milik customer. Tujuan saat unit dikirim, dipasang, atau direlokasi.',
  'Service Center': 'Tujuan saat unit dikirim untuk perbaikan.',
};

const emptyForm = {
  name: '', type: 'Merchant Site', customerId: '', merchantCode: '', address: '', city: '', province: '', postalCode: '',
  region: '', latitude: '', longitude: '', picName: '', picPhone: '',
};
type Form = typeof emptyForm;

/** Terima "-6.2, 106.8" yang ditempel dari Google Maps di field latitude. */
function parseCoordinate(value: string, min: number, max: number): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
}

const toForm = (l: Location): Form => ({
  name: l.name || '', type: (LOCATION_TYPES as string[]).includes(l.type) ? l.type : 'Warehouse', customerId: l.customerId || '',
  merchantCode: l.merchantCode || '', address: l.address || '', city: l.city || '', province: l.province || '', postalCode: l.postalCode || '',
  region: l.region || '', latitude: l.latitude != null ? String(l.latitude) : '', longitude: l.longitude != null ? String(l.longitude) : '',
  picName: l.picName || '', picPhone: l.picPhone || '',
});

export function LocationList() {
  const { locations, customers, customerById, assets } = useData();
  const { can } = useAuth();
  const { params, go } = useNav();
  const { toast, confirm } = useFeedback();
  const canWrite = can('locations.write');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [customerFilter, setCustomerFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCustomerFilter(params.customer || '');
    if (params.customer) setTypeFilter('Merchant Site');
  }, [params]);

  // Jumlah aset di tiap lokasi, dari data aset yang sama dengan menu Aset.
  const unitCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets) if (a.currentLocationId && a.assetType === 'perangkat') counts.set(a.currentLocationId, (counts.get(a.currentLocationId) || 0) + 1);
    return counts;
  }, [assets]);

  const regions = useMemo(() => Array.from(new Set(locations.map(l => l.region).filter(Boolean) as string[])).sort(), [locations]);
  const cities = useMemo(() => Array.from(new Set(locations.map(l => l.city).filter(Boolean) as string[])).sort(), [locations]);
  const provinces = useMemo(() => Array.from(new Set(locations.map(l => l.province).filter(Boolean) as string[])).sort(), [locations]);

  const filtered = locations.filter(l =>
    (typeFilter === 'All' || l.type === typeFilter) &&
    (!customerFilter || l.customerId === customerFilter) &&
    (!regionFilter || l.region === regionFilter) &&
    matchesSearch(search, l.name, l.merchantCode, l.address, l.city, l.province, l.region, l.picName, l.customerId && customerById.get(l.customerId)?.name),
  );

  const set = (field: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => prev && { ...prev, [field]: e.target.value });

  function payloadOf(f: Form) {
    let lat = parseCoordinate(f.latitude, -90, 90);
    let lng = parseCoordinate(f.longitude, -180, 180);
    // Koordinat yang ditempel utuh dari Google Maps: "-6.2088, 106.8456".
    const pair = f.latitude.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (pair && !f.longitude.trim()) { lat = Number(pair[1]); lng = Number(pair[2]); }
    if (Number.isNaN(lat) || Number.isNaN(lng)) throw new Error('Koordinat tidak valid. Contoh: latitude -6.2088, longitude 106.8456.');
    if ((lat === null) !== (lng === null)) throw new Error('Isi latitude dan longitude sekaligus, atau kosongkan keduanya.');
    const isMerchant = f.type === 'Merchant Site';
    if (isMerchant && !f.customerId) throw new Error('Merchant wajib terhubung ke customer.');
    const t = (v: string) => v.trim();
    return {
      name: t(f.name), type: f.type, address: t(f.address), city: t(f.city), province: t(f.province), postalCode: t(f.postalCode),
      region: t(f.region), latitude: lat, longitude: lng, picName: t(f.picName), picPhone: t(f.picPhone),
      customerId: isMerchant ? f.customerId : null, merchantCode: isMerchant ? t(f.merchantCode) : '',
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    let payload: ReturnType<typeof payloadOf>;
    try {
      payload = payloadOf(form);
    } catch (error) {
      return toast((error as Error).message, 'error');
    }
    const dup = locations.some(l => l.id !== editing?.id && l.name.trim().toLowerCase() === payload.name.toLowerCase() && (l.customerId || null) === payload.customerId);
    if (dup) return toast(`"${payload.name}" sudah ada${payload.customerId ? ' untuk customer ini' : ''}.`, 'error');
    setBusy(true);
    try {
      if (editing) await updateDoc(doc(db, 'locations', editing.id), { ...payload, updatedAt: serverTimestamp() });
      else await addDoc(collection(db, 'locations'), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      toast(editing ? 'Data diperbarui.' : `${LOCATION_TYPE_LABEL[payload.type]} ${payload.name} ditambahkan.`);
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
    if (count > 0) return toast(`Masih ada ${count} unit di ${l.name}. Pindahkan dulu lewat menu Pergerakan.`, 'error');
    if (!(await confirm({ title: 'Hapus lokasi?', danger: true, confirmLabel: 'Ya, Hapus', message: <><b>{l.name}</b> akan dihapus permanen.</> }))) return;
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
      const customerByName = new Map(customers.map(c => [c.name.trim().toLowerCase(), c.id]));
      const known = new Set(locations.map(l => `${l.name.trim().toLowerCase()}|${l.customerId || ''}`));
      const payloads: ReturnType<typeof payloadOf>[] = [];
      const skipped: string[] = [];
      rows.forEach((row, index) => {
        const line = index + 2;
        const name = cell(row, 'Nama', 'Nama Merchant', 'Location Name');
        if (!name) return;
        const typeText = cell(row, 'Tipe', 'Type').toLowerCase();
        const type = LOCATION_TYPES.find(t => t.toLowerCase() === typeText || LOCATION_TYPE_LABEL[t].toLowerCase() === typeText) || 'Merchant Site';
        const customerName = cell(row, 'Customer');
        const customerId = customerByName.get(customerName.toLowerCase()) || '';
        if (type === 'Merchant Site' && !customerId) return void skipped.push(`Baris ${line}: customer "${customerName}" tidak ditemukan`);
        const key = `${name.toLowerCase()}|${type === 'Merchant Site' ? customerId : ''}`;
        if (known.has(key)) return void skipped.push(`Baris ${line}: ${name} sudah ada`);
        try {
          payloads.push(payloadOf({
            name, type, customerId, merchantCode: cell(row, 'Kode Merchant'), address: cell(row, 'Alamat', 'Address'),
            city: cell(row, 'Kota'), province: cell(row, 'Provinsi'), postalCode: cell(row, 'Kode Pos'), region: cell(row, 'Region'),
            latitude: cell(row, 'Latitude'), longitude: cell(row, 'Longitude'), picName: cell(row, 'PIC'), picPhone: cell(row, 'Telepon PIC'),
          }));
          known.add(key);
        } catch (error) {
          skipped.push(`Baris ${line}: ${(error as Error).message}`);
        }
      });
      for (const group of chunk(payloads, 400)) {
        const batch = writeBatch(db);
        group.forEach(p => batch.set(doc(collection(db, 'locations')), { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
        await batch.commit();
      }
      toast(`${payloads.length} lokasi diimpor.${skipped.length ? ` ${skipped.length} dilewati:\n${skipped.slice(0, 5).join('\n')}` : ''}`, payloads.length ? 'success' : 'info');
      if (payloads.length) setShowImport(false);
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  const template = [
    { Nama: 'Toko Sinar Jaya Cab. Kemang', Tipe: 'Merchant', Customer: customers[0]?.name || 'PT Contoh', 'Kode Merchant': 'OUT-001', Alamat: 'Jl. Kemang Raya No. 10', Kota: 'Jakarta Selatan', Provinsi: 'DKI Jakarta', 'Kode Pos': '12730', Region: 'Jabodetabek', Latitude: -6.2607, Longitude: 106.8137, PIC: 'Andi', 'Telepon PIC': '0812000000' },
    { Nama: 'Gudang Utama Jakarta', Tipe: 'Gudang', Customer: '', 'Kode Merchant': '', Alamat: 'Jl. Contoh No. 1', Kota: 'Jakarta Pusat', Provinsi: 'DKI Jakarta', 'Kode Pos': '', Region: 'Jabodetabek', Latitude: '', Longitude: '', PIC: '', 'Telepon PIC': '' },
  ];
  const handleExport = () => writeExcel(filtered.map(l => ({
    Nama: l.name, Tipe: LOCATION_TYPE_LABEL[l.type] || l.type, Customer: (l.customerId && customerById.get(l.customerId)?.name) || '',
    'Kode Merchant': l.merchantCode || '', Alamat: l.address || '', Kota: l.city || '', Provinsi: l.province || '', 'Kode Pos': l.postalCode || '',
    Region: l.region || '', Latitude: l.latitude ?? '', Longitude: l.longitude ?? '', PIC: l.picName || '', 'Telepon PIC': l.picPhone || '',
    'Jumlah Unit': unitCount.get(l.id) || 0,
  })), 'Lokasi', 'Merchant_dan_Lokasi.xlsx').catch(error => toast(describeError(error), 'error'));

  const counts = { All: locations.length, ...Object.fromEntries(LOCATION_TYPES.map(t => [t, locations.filter(l => l.type === t).length])) } as Record<string, number>;

  return (
    <div className="space-y-6">
      <PageHeader icon={MapPin} title="Merchant & Lokasi" subtitle="Outlet milik customer, gudang, dan service center">
        <button onClick={handleExport} className={btnSecondary}><Download size={16} /> Export</button>
        {canWrite && (
          <>
            <button onClick={() => setShowImport(true)} className={btnSecondary}><FileUp size={16} /> Import</button>
            <button onClick={() => { setEditing(null); setForm({ ...emptyForm, customerId: customerFilter }); }} className={btnPrimary}><Plus size={16} /> Tambah</button>
          </>
        )}
      </PageHeader>

      <div className="flex flex-wrap bg-white rounded-xl border border-brand-border p-1 gap-1 w-fit">
        {['All', ...LOCATION_TYPES].map(t => (
          <button key={t} onClick={() => setTypeFilter(t)} aria-pressed={typeFilter === t} className={cn('px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider', typeFilter === t ? 'bg-brand-primary text-white' : 'text-brand-text-muted hover:bg-gray-50')}>
            {t === 'All' ? 'Semua' : LOCATION_TYPE_LABEL[t]} ({counts[t] || 0})
          </button>
        ))}
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted" size={16} />
          <input type="search" aria-label="Cari lokasi" className={cn(inputClass, 'pl-10 bg-white')} placeholder="Cari nama, kode, alamat, kota, PIC..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select aria-label="Filter customer" className={cn(inputClass, 'bg-white md:w-56')} value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}>
          <option value="">Semua customer</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Filter region" className={cn(inputClass, 'bg-white md:w-44')} value={regionFilter} onChange={e => setRegionFilter(e.target.value)}>
          <option value="">Semua region</option>
          {regions.map(r => <option key={r}>{r}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-brand-border">
          <EmptyState icon={MapPin} title={locations.length === 0 ? 'Belum ada merchant / lokasi' : 'Tidak ada yang cocok dengan filter'} hint={locations.length === 0 ? 'Tambahkan minimal satu gudang, lalu merchant untuk tiap customer.' : undefined} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(l => {
            const Icon = ICONS[l.type] || MapPin;
            const count = unitCount.get(l.id) || 0;
            const owner = l.customerId ? customerById.get(l.customerId) : undefined;
            const maps = mapsUrl(l);
            return (
              <div key={l.id} className="bg-white p-4 rounded-xl border border-brand-border hover:border-brand-primary transition-all flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-brand-primary-light text-brand-primary rounded-lg flex items-center justify-center shrink-0"><Icon size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-brand-text-main text-sm break-words">{l.name}</h3>
                    <p className="text-[10px] font-bold text-brand-primary uppercase tracking-widest">
                      {LOCATION_TYPE_LABEL[l.type] || l.type}{owner ? ` · ${owner.name}` : ''}{l.merchantCode ? ` · ${l.merchantCode}` : ''}
                    </p>
                  </div>
                  {canWrite && <button onClick={() => { setEditing(l); setForm(toForm(l)); }} aria-label={`Edit ${l.name}`} className="p-1.5 text-brand-text-muted hover:text-brand-primary border border-brand-border rounded"><Edit2 size={13} /></button>}
                  {can('delete') && <button onClick={() => handleDelete(l)} aria-label={`Hapus ${l.name}`} className="p-1.5 text-brand-text-muted hover:text-red-600 border border-brand-border rounded"><Trash2 size={13} /></button>}
                </div>
                <div className="text-xs text-brand-text-muted leading-relaxed">
                  <p>{l.address || '-'}</p>
                  {(l.city || l.province || l.postalCode) && <p className="font-medium text-brand-text-main">{[l.city, l.province, l.postalCode].filter(Boolean).join(', ')}</p>}
                  {l.region && <span className="inline-block mt-1 text-[10px] font-bold uppercase bg-gray-100 px-2 py-0.5 rounded">{l.region}</span>}
                </div>
                {(l.picName || l.picPhone) && <p className="text-xs text-brand-text-main flex items-center gap-1.5"><Phone size={12} className="text-brand-text-muted" />{[l.picName, l.picPhone].filter(Boolean).join(' · ')}</p>}
                <div className="mt-auto flex items-center justify-between gap-2">
                  <button onClick={() => go('inventory', { location: l.id })} className="text-[11px] font-bold text-brand-primary hover:underline">{count} unit di sini →</button>
                  {maps && <a href={maps} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-brand-text-muted hover:text-brand-primary flex items-center gap-1">Peta <ExternalLink size={11} /></a>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} busy={busy} size="lg" title={editing ? 'Edit Lokasi' : 'Tambah Merchant / Lokasi'} subtitle={editing?.name}>
        {form && (
          <form onSubmit={handleSubmit} className="p-6 grid grid-cols-2 gap-4">
            <Field label="Tipe" hint={TYPE_HINT[form.type]}>
              <select className={inputClass} value={form.type} onChange={set('type')}>{LOCATION_TYPES.map(t => <option key={t} value={t}>{LOCATION_TYPE_LABEL[t]}</option>)}</select>
            </Field>
            {form.type === 'Merchant Site' ? (
              <Field label="Customer Pemilik">
                <select required className={inputClass} value={form.customerId} onChange={set('customerId')}>
                  <option value="">Pilih customer...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            ) : <div />}
            <Field label={form.type === 'Merchant Site' ? 'Nama Merchant / Outlet' : 'Nama Lokasi'}><input required maxLength={200} className={inputClass} value={form.name} onChange={set('name')} /></Field>
            {form.type === 'Merchant Site' ? (
              <Field label="Kode Merchant / Outlet" hint="Kode dari customer, opsional."><input maxLength={64} className={inputClass} value={form.merchantCode} onChange={set('merchantCode')} /></Field>
            ) : <div />}
            <Field label="Alamat Lengkap" className="col-span-2"><textarea required maxLength={500} className={cn(inputClass, 'min-h-[60px]')} value={form.address} onChange={set('address')} /></Field>
            <Field label="Kota / Kabupaten"><input list="city-list" maxLength={100} className={inputClass} value={form.city} onChange={set('city')} /></Field>
            <Field label="Provinsi"><input list="province-list" maxLength={100} className={inputClass} value={form.province} onChange={set('province')} /></Field>
            <Field label="Kode Pos"><input maxLength={10} className={inputClass} value={form.postalCode} onChange={set('postalCode')} /></Field>
            <Field label="Region / Area" hint="Untuk pembagian wilayah teknisi, mis. Jabodetabek, Jatim."><input list="region-list" maxLength={100} className={inputClass} value={form.region} onChange={set('region')} /></Field>
            <datalist id="city-list">{cities.map(c => <option key={c} value={c} />)}</datalist>
            <datalist id="province-list">{provinces.map(p => <option key={p} value={p} />)}</datalist>
            <datalist id="region-list">{regions.map(r => <option key={r} value={r} />)}</datalist>
            <Field label="Latitude" hint="Bisa tempel langsung dari Google Maps, mis. -6.2088, 106.8456"><input inputMode="decimal" className={inputClass} value={form.latitude} onChange={set('latitude')} /></Field>
            <Field label="Longitude"><input inputMode="decimal" className={inputClass} value={form.longitude} onChange={set('longitude')} /></Field>
            <Field label="Nama PIC"><input maxLength={200} className={inputClass} value={form.picName} onChange={set('picName')} /></Field>
            <Field label="Telepon PIC"><input maxLength={64} className={inputClass} value={form.picPhone} onChange={set('picPhone')} /></Field>
            <div className="col-span-2 flex gap-3 pt-2">
              <button type="button" disabled={busy} onClick={() => setForm(null)} className={cn(btnSecondary, 'flex-1 py-3')}>Batal</button>
              <button type="submit" disabled={busy} className={cn(btnPrimary, 'flex-1 py-3')}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={showImport} onClose={() => setShowImport(false)} busy={busy} title="Import Merchant & Lokasi" subtitle="Bulk import dari Excel">
        <div className="p-6 space-y-5">
          <p className="text-xs text-brand-text-muted leading-relaxed">Kolom <b>Tipe</b>: Merchant / Gudang / Service Center. Merchant wajib mengisi kolom <b>Customer</b> sesuai nama di Master Customer.</p>
          <button onClick={() => writeExcel(template, 'Template', 'Template_Import_Merchant_Lokasi.xlsx')} className="flex items-center gap-2 text-xs font-bold text-brand-primary hover:underline"><Download size={14} /> Unduh Template</button>
          <FileDrop busy={busy} onFile={handleImport} />
        </div>
      </Modal>
    </div>
  );
}
