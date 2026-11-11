import React, { useEffect, useState } from 'react';
import { describeError } from '../../lib/firebase';
import { ASSET_TYPE_LABEL, CONDITIONS, INITIAL_STATUSES, PERIPHERAL_TYPES, SIM_TYPES, statusMeta, type AssetType } from '../../lib/constants';
import { createAsset, emptyAssetInput, updateAsset, type AssetInput } from '../../lib/assets';
import { cn } from '../../lib/utils';
import type { Asset } from '../../lib/types';
import { useData } from '../../context/DataContext';
import { Field, Modal, StatusBadge, btnPrimary, btnSecondary, inputClass, useFeedback } from '../../components/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  assetType: AssetType;
  /** Diisi = mode edit. */
  asset?: Asset | null;
}

/** Satu form untuk registrasi & edit, sehingga field keduanya tidak pernah berbeda. */
export function AssetFormModal({ open, onClose, assetType, asset }: Props) {
  const { assets, childrenOf } = useData();
  const { toast } = useFeedback();
  const [form, setForm] = useState<AssetInput>(emptyAssetInput(assetType));
  const [busy, setBusy] = useState(false);
  const isEdit = !!asset;
  const type = asset?.assetType || assetType;

  useEffect(() => {
    if (!open) return;
    if (!asset) return setForm(emptyAssetInput(assetType));
    const peripherals = childrenOf(asset.id).filter(c => c.assetType === 'peripheral');
    setForm({
      ...emptyAssetInput(asset.assetType),
      sn: asset.sn, status: asset.status,
      vendor: asset.vendor || '', model: asset.model || '', tid: asset.tid || '', mid: asset.mid || '',
      osVersion: asset.osVersion || '', condition: asset.condition || 'New', imei: asset.imei || '',
      provider: asset.provider || '', msisdn: asset.msisdn || '', simType: asset.simType || 'Public',
      peripheralType: asset.peripheralType || '',
      linkTargetSN: asset.parentDeviceSN || '',
      chargerSN: peripherals.find(p => p.peripheralType === 'Charger')?.sn || '',
      batterySN: peripherals.find(p => p.peripheralType === 'Battery')?.sn || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset?.id, assetType]);

  const set = (field: keyof AssetInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (asset) await updateAsset(asset, form, assets);
      else await createAsset(form, assets);
      toast(isEdit ? `Data ${form.sn} diperbarui.` : `${ASSET_TYPE_LABEL[type]} ${form.sn.trim()} terdaftar.`);
      onClose();
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  const snLabel = type === 'sim' ? 'ICCID (Serial Number)' : type === 'peripheral' ? 'Serial Number Peripheral' : 'Serial Number';
  const freeDevices = assets.filter(a => a.assetType === 'perangkat');
  const freePeripherals = (pType: string) => assets.filter(a => a.assetType === 'peripheral' && a.peripheralType === pType && (!a.parentDeviceId || a.parentDeviceId === asset?.id));

  return (
    <Modal open={open} onClose={onClose} busy={busy} title={isEdit ? 'Edit Aset' : `Registrasi ${ASSET_TYPE_LABEL[type]}`} subtitle={isEdit ? `SN: ${asset!.sn}` : 'Input manual'}>
      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label={snLabel} className="col-span-2" hint={isEdit ? 'Serial number tidak bisa diubah setelah terdaftar.' : undefined}>
            <input required disabled={isEdit} maxLength={128} className={cn(inputClass, 'font-mono')} value={form.sn} onChange={set('sn')} />
          </Field>

          {type === 'perangkat' && (
            <>
              <Field label="Merk (Vendor)"><input required maxLength={100} className={inputClass} value={form.vendor} onChange={set('vendor')} /></Field>
              <Field label="Model"><input required maxLength={100} className={inputClass} value={form.model} onChange={set('model')} /></Field>
              <Field label="Terminal ID (TID)"><input maxLength={64} className={inputClass} value={form.tid} onChange={set('tid')} /></Field>
              <Field label="Merchant ID (MID)"><input maxLength={64} className={inputClass} value={form.mid} onChange={set('mid')} /></Field>
              <Field label="OS / Version"><input className={inputClass} value={form.osVersion} onChange={set('osVersion')} /></Field>
              <Field label="IMEI"><input className={inputClass} value={form.imei} onChange={set('imei')} /></Field>
              <Field label="Kondisi">
                <select className={inputClass} value={form.condition} onChange={set('condition')}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select>
              </Field>
              <div className="col-span-2 border-t border-brand-border pt-4 grid grid-cols-2 gap-4">
                <p className="col-span-2 text-[11px] text-brand-text-muted -mb-1">
                  Kelengkapan: isi SN untuk menautkan. SN yang belum terdaftar otomatis dibuat sebagai peripheral baru; mengosongkan SN melepas tautannya.
                </p>
                <Field label="SN Charger"><input list="charger-sn-list" className={inputClass} value={form.chargerSN} onChange={set('chargerSN')} /></Field>
                <Field label="SN Battery"><input list="battery-sn-list" className={inputClass} value={form.batterySN} onChange={set('batterySN')} /></Field>
                <datalist id="charger-sn-list">{freePeripherals('Charger').map(p => <option key={p.id} value={p.sn} />)}</datalist>
                <datalist id="battery-sn-list">{freePeripherals('Battery').map(p => <option key={p.id} value={p.sn} />)}</datalist>
              </div>
            </>
          )}

          {type === 'sim' && (
            <>
              <Field label="MSISDN"><input className={inputClass} value={form.msisdn} onChange={set('msisdn')} /></Field>
              <Field label="Provider"><input className={inputClass} placeholder="Telkomsel / XL / Indosat" value={form.provider} onChange={set('provider')} /></Field>
              <Field label="Jenis SIM">
                <select className={inputClass} value={form.simType} onChange={set('simType')}>{SIM_TYPES.map(s => <option key={s}>{s}</option>)}</select>
              </Field>
            </>
          )}

          {type === 'peripheral' && (
            <>
              <Field label="Jenis Peripheral">
                <select required className={inputClass} value={form.peripheralType} onChange={set('peripheralType')}>
                  <option value="">Pilih jenis</option>
                  {PERIPHERAL_TYPES.map(p => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Merk"><input className={inputClass} value={form.vendor} onChange={set('vendor')} /></Field>
              <Field label="Model"><input className={inputClass} value={form.model} onChange={set('model')} /></Field>
            </>
          )}

          {type !== 'perangkat' && (
            <Field label="Tautkan ke Perangkat (SN)" hint="Opsional. Status & lokasi akan mengikuti perangkat induk. Kosongkan untuk melepas tautan.">
              <input list="device-sn-list" className={inputClass} placeholder="Ketik SN perangkat..." value={form.linkTargetSN} onChange={set('linkTargetSN')} />
              <datalist id="device-sn-list">{freeDevices.slice(0, 500).map(d => <option key={d.id} value={d.sn}>{[d.vendor, d.model].filter(Boolean).join(' ')}</option>)}</datalist>
            </Field>
          )}

          {isEdit ? (
            <div className="col-span-2 flex items-center justify-between gap-3 p-3 bg-gray-50 border border-brand-border rounded-lg">
              <span className="text-[11px] text-brand-text-muted leading-snug">Status hanya berubah lewat menu <b>Pergerakan EDC</b>, supaya riwayat & kontrak selalu tercatat.</span>
              <StatusBadge status={asset!.status} />
            </div>
          ) : (
            !form.linkTargetSN.trim() && (
              <Field label="Status Awal" className="col-span-2">
                <select className={inputClass} value={form.status} onChange={set('status')}>
                  {INITIAL_STATUSES.map(s => <option key={s} value={s}>{statusMeta(s).label}</option>)}
                </select>
              </Field>
            )
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" disabled={busy} onClick={onClose} className={cn(btnSecondary, 'flex-1 py-3')}>Batal</button>
          <button type="submit" disabled={busy} className={cn(btnPrimary, 'flex-1 py-3')}>{busy ? 'Menyimpan...' : isEdit ? 'Simpan Perubahan' : 'Daftarkan Aset'}</button>
        </div>
      </form>
    </Modal>
  );
}
