import React from 'react';
import { INITIAL_STATUSES, statusMeta } from '../../lib/constants';
import { todayISO, type ReceiptInput } from '../../lib/assets';
import { cn } from '../../lib/utils';
import { useData } from '../../context/DataContext';
import { useNav } from '../../context/NavContext';
import { Field, inputClass } from '../../components/ui';

/**
 * Data penerimaan barang dari supplier (GR). Dipakai di form registrasi dan import,
 * supaya kedua jalur mencatat data pengadaan yang sama.
 */
export function ReceiptFields<T extends ReceiptInput & { status?: string }>({
  value, onChange, showStatus = true, warrantyHint,
}: {
  value: T;
  onChange: (next: T) => void;
  showStatus?: boolean;
  /** Teks bantu di field garansi, mis. "Otomatis 12 bulan dari master model". */
  warrantyHint?: string;
}) {
  const { suppliers } = useData();
  const { go } = useNav();
  const set = (field: keyof T) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [field]: e.target.value });

  return (
    <div className="col-span-2 border border-brand-border rounded-xl p-4 bg-gray-50/50 grid grid-cols-2 gap-4">
      <p className="col-span-2 text-[10px] font-black text-brand-primary uppercase tracking-[0.2em]">Penerimaan dari Supplier</p>
      <Field label="Supplier" className="col-span-2" hint={suppliers.length === 0 ? 'Master supplier masih kosong.' : undefined}>
        <select className={cn(inputClass, 'bg-white')} value={value.supplierId} onChange={set('supplierId')}>
          <option value="">(tidak diketahui / data lama)</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      {suppliers.length === 0 && (
        <button type="button" onClick={() => go('suppliers')} className="col-span-2 -mt-2 text-left text-[11px] font-bold text-brand-primary hover:underline">
          + Tambah supplier di Master Supplier & Model
        </button>
      )}
      <Field label="No. PO"><input maxLength={64} className={cn(inputClass, 'bg-white')} value={value.poNumber} onChange={set('poNumber')} /></Field>
      <Field label="No. Surat Jalan / DO"><input maxLength={64} className={cn(inputClass, 'bg-white')} value={value.deliveryNoteNo} onChange={set('deliveryNoteNo')} /></Field>
      <Field label="Tanggal Terima"><input type="date" max={todayISO()} className={cn(inputClass, 'bg-white')} value={value.receivedDate} onChange={set('receivedDate')} /></Field>
      <Field label="Harga Beli per Unit (IDR)"><input type="number" min={0} className={cn(inputClass, 'bg-white')} value={value.purchasePrice} onChange={set('purchasePrice')} /></Field>
      <Field label="Garansi Sampai" hint={warrantyHint}>
        <input type="date" className={cn(inputClass, 'bg-white')} value={value.warrantyUntil} onChange={set('warrantyUntil')} />
      </Field>
      {showStatus && value.status !== undefined && (
        <Field label="Status Awal" hint="Stok Masuk (QC) = perlu diperiksa dulu lewat Pergerakan > Lolos QC.">
          <select className={cn(inputClass, 'bg-white')} value={value.status} onChange={set('status' as keyof T)}>
            {INITIAL_STATUSES.map(s => <option key={s} value={s}>{statusMeta(s).label}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}
