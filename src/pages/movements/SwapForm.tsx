import React, { useMemo, useState } from 'react';
import { ArrowDown, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { describeError } from '../../lib/firebase';
import { STATUS, SWAP_IN_STATUSES, SWAP_OUT_STATUSES, statusMeta } from '../../lib/constants';
import { executeSwap, fieldLabel, swapProblem } from '../../lib/movements';
import { cn, formatDate, locationLabel, matchesSearch } from '../../lib/utils';
import type { Asset } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { Field, StatusBadge, btnPrimary, inputClass, useFeedback } from '../../components/ui';

const today = () => format(new Date(), 'yyyy-MM-dd');

/** Pencarian satu unit dengan saran, dipakai untuk unit lama & unit pengganti. */
function UnitPicker({ label, value, onChange, candidates, emptyHint }: {
  label: string; value: Asset | undefined; onChange: (asset: Asset | undefined) => void; candidates: Asset[]; emptyHint: string;
}) {
  const [search, setSearch] = useState('');
  const options = useMemo(
    () => (search.trim() ? candidates.filter(a => matchesSearch(search, a.sn, a.tid, a.mid, a.customerName, a.locationName)).slice(0, 20) : []),
    [candidates, search],
  );
  if (value) {
    return (
      <div className="space-y-1.5">
        <span className="block text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">{label}</span>
        <div className="flex items-start justify-between gap-3 p-3 bg-brand-primary-light border border-brand-primary/20 rounded-lg">
          <div className="min-w-0 text-xs">
            <p className="font-black text-brand-text-main">{value.sn}</p>
            <p className="text-brand-text-muted">{[value.vendor, value.model].filter(Boolean).join(' ')} · TID {value.tid || '-'}</p>
            {value.customerName && <p className="text-brand-text-main font-medium">{value.customerName} · {locationLabel(value)}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={value.status} />
            <button type="button" aria-label={`Ganti ${label}`} onClick={() => onChange(undefined)} className="text-brand-text-muted hover:text-red-500"><X size={14} /></button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <span className="block text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">{label}</span>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input aria-label={label} className={cn(inputClass, 'pl-9')} placeholder="Cari SN / TID / merchant..." value={search} onChange={e => setSearch(e.target.value)} />
        {options.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-brand-border rounded-lg shadow-xl max-h-[220px] overflow-y-auto">
            {options.map(a => (
              <button key={a.id} type="button" onClick={() => { onChange(a); setSearch(''); }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0">
                <span className="min-w-0">
                  <span className="font-bold text-brand-text-main block truncate">{a.sn}</span>
                  {a.customerName && <span className="text-[10px] text-brand-text-muted block truncate">{a.customerName} · {locationLabel(a)}</span>}
                </span>
                <StatusBadge status={a.status} />
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] text-brand-text-muted px-1">{emptyHint}</p>
    </div>
  );
}

export function SwapForm() {
  const { assets, locations, childrenOf, customerById, approvalByAsset } = useData();
  const { profile } = useAuth();
  const { toast, confirm } = useFeedback();

  const [oldAsset, setOldAsset] = useState<Asset>();
  const [newAsset, setNewAsset] = useState<Asset>();
  const [oldTo, setOldTo] = useState<string>(STATUS.REPAIR);
  const [oldLocationId, setOldLocationId] = useState('');
  const [moveLinked, setMoveLinked] = useState(true);
  const [moveTidMid, setMoveTidMid] = useState(true);
  const [transactionDate, setTransactionDate] = useState(today());
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [picName, setPicName] = useState('');
  const [technicianName, setTechnicianName] = useState(profile?.displayName || profile?.username || '');
  const [busy, setBusy] = useState(false);

  const installed = useMemo(() => assets.filter(a => a.assetType === 'perangkat' && a.status === STATUS.INSTALLED && a.contractStatus === 'Active' && !approvalByAsset.has(a.id)), [assets, approvalByAsset]);
  const stock = useMemo(() => assets.filter(a => a.assetType === 'perangkat' && SWAP_IN_STATUSES.includes(a.status) && !approvalByAsset.has(a.id)), [assets, approvalByAsset]);
  // Lokasi unit lama setelah dilepas: gudang untuk ditarik, service center untuk perbaikan.
  const oldLocationOptions = locations.filter(l => l.type === (oldTo === STATUS.REPAIR ? 'Service Center' : 'Warehouse'));
  const live = (a?: Asset) => (a ? assets.find(x => x.id === a.id) : undefined);
  const oldLive = live(oldAsset);
  const newLive = live(newAsset);
  const oldLinked = oldLive ? childrenOf(oldLive.id) : [];

  const problems: string[] = [];
  const problem = swapProblem(oldLive, newLive);
  if (problem) problems.push(problem);
  for (const a of [oldLive, newLive]) if (a && approvalByAsset.has(a.id)) problems.push(`Unit ${a.sn} sedang dalam pengajuan persetujuan.`);
  if (!transactionDate || transactionDate > today()) problems.push('Tanggal transaksi tidak valid.');
  if (!technicianName.trim()) problems.push('Isi nama teknisi.');
  if (!picName.trim()) problems.push('Isi nama PIC merchant untuk Berita Acara.');

  function reset() {
    setOldAsset(undefined);
    setNewAsset(undefined);
    setReferenceNo('');
    setNotes('');
    setPicName('');
    setTransactionDate(today());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (problems.length || !oldLive || !newLive) return;
    const ok = await confirm({
      title: 'Proses tukar unit?',
      confirmLabel: 'Ya, Tukar Unit',
      message: (
        <>
          <b>{oldLive.sn}</b> dilepas dari {oldLive.customerName} ({locationLabel(oldLive)}) menjadi <b>{statusMeta(oldTo).label}</b>, diganti <b>{newLive.sn}</b>.
          Kontrak berjalan (berakhir {formatDate(oldLive.expectedEndDate)}) pindah ke unit pengganti tanpa denda.
          {moveTidMid && <> TID/MID {oldLive.tid || '-'} / {oldLive.mid || '-'} ikut pindah.</>}
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { baNumber } = await executeSwap({
        oldAsset: oldLive, newAsset: newLive, oldTo,
        oldLocation: locations.find(l => l.id === oldLocationId) || null,
        moveLinked, moveTidMid, transactionDate, notes, picName, technicianName,
        details: { referenceNo },
      }, { childrenOf, customerById });
      toast(`Unit ${oldLive.sn} diganti ${newLive.sn}.\nBerita Acara ${baNumber} diunduh.`);
      reset();
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <UnitPicker label="2. Unit Lama (Terpasang)" value={oldLive} onChange={setOldAsset} candidates={installed} emptyHint="Hanya unit terpasang dengan kontrak aktif." />

      {oldLive && (
        <div className="grid grid-cols-2 gap-3 pl-3 border-l-2 border-red-200">
          <Field label="Status Unit Lama">
            <select className={inputClass} value={oldTo} onChange={e => { setOldTo(e.target.value); setOldLocationId(''); }}>
              {SWAP_OUT_STATUSES.map(s => <option key={s} value={s}>{statusMeta(s).label}</option>)}
            </select>
          </Field>
          <Field label={oldTo === STATUS.REPAIR ? 'Dikirim ke (Service Center)' : 'Disimpan di (Gudang)'}>
            <select className={inputClass} value={oldLocationId} onChange={e => setOldLocationId(e.target.value)}>
              <option value="">Tidak ditentukan</option>
              {oldLocationOptions.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        </div>
      )}

      <div className="flex justify-center text-brand-text-muted"><ArrowDown size={18} /></div>

      <UnitPicker label="3. Unit Pengganti (Stok)" value={newLive} onChange={setNewAsset} candidates={stock} emptyHint={`Unit berstatus ${SWAP_IN_STATUSES.map(s => statusMeta(s).label).join(' / ')}.`} />

      {oldLive && (
        <div className="space-y-2 p-3 bg-gray-50 border border-brand-border rounded-lg text-xs">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={moveTidMid} onChange={e => setMoveTidMid(e.target.checked)} />
            <span>Pindahkan <b>TID / MID</b> ({oldLive.tid || '-'} / {oldLive.mid || '-'}) ke unit pengganti</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={moveLinked} onChange={e => setMoveLinked(e.target.checked)} disabled={oldLinked.length === 0} />
            <span>
              Pindahkan <b>SIM & peripheral</b> ke unit pengganti
              {oldLinked.length ? ` (${oldLinked.map(c => c.sn).join(', ')})` : ' (tidak ada yang tertaut)'}
            </span>
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tanggal Transaksi"><input type="date" required max={today()} className={inputClass} value={transactionDate} onChange={e => setTransactionDate(e.target.value)} /></Field>
        <Field label={fieldLabel('Swap', 'referenceNo')}><input maxLength={64} className={inputClass} value={referenceNo} onChange={e => setReferenceNo(e.target.value)} /></Field>
        <Field label="Nama PIC Merchant"><input className={inputClass} value={picName} onChange={e => setPicName(e.target.value)} /></Field>
        <Field label="Nama Teknisi"><input className={inputClass} value={technicianName} onChange={e => setTechnicianName(e.target.value)} /></Field>
      </div>
      <Field label="Catatan / Keluhan"><textarea maxLength={1000} className={cn(inputClass, 'min-h-[60px]')} placeholder="Mis. layar mati, tidak bisa print" value={notes} onChange={e => setNotes(e.target.value)} /></Field>

      {(oldLive || newLive) && problems.length > 0 && (
        <ul className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 font-medium space-y-1">{problems.map(p => <li key={p}>• {p}</li>)}</ul>
      )}
      <button type="submit" disabled={busy || problems.length > 0} className={cn(btnPrimary, 'w-full py-3')}>{busy ? 'Memproses...' : 'Proses Tukar Unit & Unduh BA'}</button>
    </form>
  );
}
