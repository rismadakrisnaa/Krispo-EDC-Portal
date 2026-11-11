import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ArrowLeftRight, ArrowRight, Box, Download, Edit2, FileCheck, History, X } from 'lucide-react';
import { db, describeError } from '../../lib/firebase';
import { movementLabel, statusMeta } from '../../lib/constants';
import { contractHealth } from '../../lib/contract';
import { linkToDevice, unlinkFromDevice } from '../../lib/assets';
import { redownloadBA } from '../../lib/movements';
import { downloadAssetReportPDF } from '../../lib/baGenerator';
import { cn, formatDate, formatIDR, locationLabel } from '../../lib/utils';
import type { Asset, Movement } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { useNav } from '../../context/NavContext';
import { Modal, Spinner, StatusBadge, btnPrimary, btnSecondary, inputClass, useFeedback } from '../../components/ui';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-brand-border pb-2 text-xs">
      <span className="font-bold text-brand-text-muted uppercase shrink-0">{label}</span>
      <span className="font-bold text-brand-text-main text-right break-all">{children || '-'}</span>
    </div>
  );
}

export function AssetDetailModal({ assetId, onClose, onEdit }: { assetId: string | null; onClose: () => void; onEdit: (asset: Asset) => void }) {
  // Selalu baca data live dari context, bukan salinan saat modal dibuka.
  const { assets, assetById, customerById, childrenOf } = useData();
  const { can } = useAuth();
  const { go, startMovement } = useNav();
  const { toast, confirm } = useFeedback();
  const asset = assetId ? assetById.get(assetId) : undefined;

  const [history, setHistory] = useState<Movement[] | null>(null);
  const [linkSn, setLinkSn] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHistory(null);
    setLinkSn('');
    if (!assetId) return;
    let cancelled = false;
    // Urut di client supaya tidak butuh composite index Firestore.
    getDocs(query(collection(db, 'movements'), where('edcId', '==', assetId)))
      .then(snap => {
        if (cancelled) return;
        const rows = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Movement);
        rows.sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));
        setHistory(rows);
      })
      .catch(error => { console.error(error); if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [assetId, asset?.status, asset?.updatedAt?.toMillis()]);

  if (!asset) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const children = childrenOf(asset.id);
  const customer = asset.currentCustomerId ? customerById.get(asset.currentCustomerId) : undefined;
  const contract = contractHealth(asset);
  const totalPenalty = (asset.penaltyAmount || 0) + (asset.partPenaltyAmount || 0);

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await action();
      if (success) toast(success);
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async (child: Asset) => {
    const ok = await confirm({
      title: 'Lepas tautan?',
      message: <>Tautan <b>{child.sn}</b> ke perangkat <b>{child.parentDeviceSN}</b> dilepas. Statusnya kembali menjadi <b>Tersedia</b> di gudang.</>,
      confirmLabel: 'Lepas Tautan',
    });
    if (ok) run(() => unlinkFromDevice(child), `Tautan ${child.sn} dilepas.`);
  };

  const handleReport = () => run(() => downloadAssetReportPDF({
    sn: asset.sn, tid: asset.tid, mid: asset.mid, vendor: asset.vendor, model: asset.model,
    status: statusMeta(asset.status).label, condition: asset.condition,
    customerName: asset.customerName || '(Gudang)', customerAddress: customer?.address || '-',
    locationName: locationLabel(asset),
    contractStatus: asset.contractStatus, contractEndDate: contract.effectiveEnd ? formatDate(contract.effectiveEnd) : '-',
    monthlyRental: asset.currentMonthlyRental, penaltyAmount: totalPenalty,
    peripherals: children.map(c => ({ type: c.assetType === 'sim' ? 'SIM Card' : c.peripheralType || 'Peripheral', sn: c.sn })),
    history: (history || []).map(m => ({ date: formatDate(m.timestamp, 'dd MMM yyyy'), type: movementLabel(m.type), status: statusMeta(m.toStatus).label, by: m.userName || '-' })),
  }));

  return (
    <Modal
      open onClose={onClose} busy={busy} size="lg"
      title={asset.sn}
      subtitle={asset.assetType === 'sim' ? `SIM · ${asset.provider || '-'}` : [asset.peripheralType, asset.vendor, asset.model].filter(Boolean).join(' · ')}
      headerExtra={<StatusBadge status={asset.status} />}
    >
      <div className="p-6 space-y-7">
        <div className="flex flex-wrap gap-2">
          {asset.assetType === 'perangkat' && can('movements.create') && (
            <button onClick={() => { onClose(); startMovement([asset.id]); }} className={btnPrimary}><ArrowLeftRight size={14} /> Proses Pergerakan</button>
          )}
          {can('assets.update') && <button onClick={() => onEdit(asset)} className={btnSecondary}><Edit2 size={14} /> Edit</button>}
          {asset.assetType === 'perangkat' && <button disabled={busy || history === null} onClick={handleReport} className={btnSecondary}><Download size={14} /> Laporan PDF</button>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
          <section className="space-y-3">
            <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em]">Identitas</p>
            {asset.assetType === 'perangkat' && (
              <>
                <Row label="Merk / Model">{[asset.vendor, asset.model].filter(Boolean).join(' / ')}</Row>
                <Row label="Terminal ID">{asset.tid}</Row>
                <Row label="Merchant ID">{asset.mid}</Row>
                <Row label="OS / Version">{asset.osVersion}</Row>
                <Row label="IMEI">{asset.imei}</Row>
                <Row label="Kondisi">{asset.condition}</Row>
              </>
            )}
            {asset.assetType === 'sim' && (
              <>
                <Row label="ICCID">{asset.sn}</Row>
                <Row label="MSISDN">{asset.msisdn}</Row>
                <Row label="Provider">{asset.provider}</Row>
                <Row label="Jenis SIM">{asset.simType}</Row>
              </>
            )}
            {asset.assetType === 'peripheral' && (
              <>
                <Row label="Jenis">{asset.peripheralType}</Row>
                <Row label="Merk / Model">{[asset.vendor, asset.model].filter(Boolean).join(' / ')}</Row>
              </>
            )}
          </section>

          <section className="space-y-3">
            <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em]">Posisi Saat Ini</p>
            <Row label="Customer">
              {asset.currentCustomerId
                ? <button className="text-brand-primary hover:underline" onClick={() => { onClose(); go('customers', { q: asset.customerName || '' }); }}>{asset.customerName}</button>
                : '(Gudang)'}
            </Row>
            <Row label="Lokasi">{locationLabel(asset)}</Row>
            <Row label="Update Terakhir">{formatDate(asset.updatedAt, 'dd MMM yyyy HH:mm')}</Row>

            {asset.assetType === 'perangkat' && asset.contractStatus && (
              <div className="pt-2 space-y-3">
                <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em]">Kontrak</p>
                <Row label="Status">{asset.contractStatus}{contract.isARO && asset.contractStatus === 'Active' ? ' (ARO)' : ''}</Row>
                <Row label="Customer Kontrak">{asset.contractCustomerName || asset.customerName}</Row>
                <Row label="Periode">{formatDate(asset.contractStartDate)} s/d {formatDate(asset.contractEndDateActual || contract.effectiveEnd)}</Row>
                <Row label="Sewa / Bulan">{formatIDR(asset.currentMonthlyRental)}</Row>
                {totalPenalty > 0 && <Row label="Total Denda"><span className="text-red-600">{formatIDR(totalPenalty)}</span></Row>}
                <button className="text-[11px] font-bold text-brand-primary hover:underline" onClick={() => { onClose(); go('contracts', { q: asset.sn }); }}>Lihat di Monitoring Kontrak →</button>
              </div>
            )}
          </section>
        </div>

        {/* Tautan SIM / peripheral */}
        {asset.assetType === 'perangkat' ? (
          <section className="space-y-3">
            <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em]">SIM & Peripheral Tertaut ({children.length})</p>
            {children.length === 0 && <p className="text-xs text-brand-text-muted italic">Belum ada. Tautkan dari form Edit (charger / battery) atau dari detail SIM / peripheral.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {children.map(child => (
                <div key={child.id} className="flex items-center justify-between gap-2 p-2.5 bg-gray-50 rounded-lg border border-brand-border">
                  <div className="flex items-center gap-2 min-w-0">
                    <Box size={14} className="text-brand-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-black text-brand-text-main truncate">{child.assetType === 'sim' ? 'SIM' : child.peripheralType}: {child.sn}</p>
                      <p className="text-[9px] text-brand-text-muted font-bold uppercase truncate">{child.assetType === 'sim' ? child.provider || '-' : child.vendor || '-'}</p>
                    </div>
                  </div>
                  {can('assets.update') && (
                    <button disabled={busy} onClick={() => handleUnlink(child)} aria-label={`Lepas tautan ${child.sn}`} className="p-1 text-gray-400 hover:text-red-500"><X size={14} /></button>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em]">Perangkat Induk</p>
            {asset.parentDeviceId ? (
              <div className="flex items-center justify-between gap-3 p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
                <span className="text-xs font-bold text-indigo-800">Tertaut ke {asset.parentDeviceSN}. Status & lokasi mengikuti perangkat ini.</span>
                {can('assets.update') && <button disabled={busy} onClick={() => handleUnlink(asset)} className="text-[11px] font-black text-red-600 hover:underline shrink-0">Lepas</button>}
              </div>
            ) : can('assets.update') ? (
              <form
                className="flex gap-2"
                onSubmit={e => { e.preventDefault(); if (linkSn.trim()) run(() => linkToDevice(asset, linkSn, assets).then(() => setLinkSn('')), 'Berhasil ditautkan.'); }}
              >
                <input list="detail-device-sn" className={inputClass} placeholder="SN perangkat..." value={linkSn} onChange={e => setLinkSn(e.target.value)} />
                <datalist id="detail-device-sn">{assets.filter(a => a.assetType === 'perangkat').slice(0, 500).map(d => <option key={d.id} value={d.sn} />)}</datalist>
                <button type="submit" disabled={busy || !linkSn.trim()} className={btnPrimary}>Tautkan</button>
              </form>
            ) : (
              <p className="text-xs text-brand-text-muted italic">Berdiri sendiri (tidak tertaut).</p>
            )}
          </section>
        )}

        {/* Riwayat */}
        <section className="space-y-3">
          <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em]">Riwayat Pergerakan</p>
          {history === null ? (
            <div className="flex justify-center py-6 text-brand-text-muted"><Spinner /></div>
          ) : history.length === 0 ? (
            <p className="text-xs text-brand-text-muted italic py-4 text-center border border-dashed border-brand-border rounded-xl">
              {asset.parentDeviceId ? 'Riwayat tercatat pada perangkat induknya.' : 'Belum ada riwayat.'}
            </p>
          ) : (
            <div className="space-y-2">
              {history.map(move => (
                <div key={move.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50/60 rounded-xl border border-brand-border">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-white border border-brand-border flex items-center justify-center text-brand-primary shrink-0"><History size={15} /></div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-brand-text-main">{movementLabel(move.type)}</span>
                        <ArrowRight size={10} className="text-gray-400" />
                        <StatusBadge status={move.toStatus} />
                      </div>
                      <p className={cn('text-[10px] text-brand-text-muted font-bold mt-0.5 truncate')}>
                        {formatDate(move.timestamp, 'dd MMM yyyy HH:mm')} · {move.userName || 'System'}{move.customerName ? ` · ${move.customerName}` : ''}
                      </p>
                    </div>
                  </div>
                  {move.baGenerated && (
                    <button
                      disabled={busy} onClick={() => run(() => redownloadBA(move, assetById, customerById))}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-emerald-200 text-emerald-700 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-50 shrink-0"
                    >
                      <FileCheck size={12} /> BA
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
