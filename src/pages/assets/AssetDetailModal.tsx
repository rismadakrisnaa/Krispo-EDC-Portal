import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ArrowLeftRight, ArrowRight, Box, Download, Edit2, ExternalLink, FileCheck, X } from 'lucide-react';
import { db, describeError } from '../../lib/firebase';
import { movementLabel, statusMeta } from '../../lib/constants';
import { contractHealth } from '../../lib/contract';
import { linkToDevice, unlinkFromDevice } from '../../lib/assets';
import { redownloadBA } from '../../lib/movements';
import { downloadAssetReportPDF } from '../../lib/baGenerator';
import { cn, daysBetween, formatDate, formatDuration, formatIDR, locationLabel, mapsUrl, movementDetailText } from '../../lib/utils';
import type { Asset, Movement } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { useNav } from '../../context/NavContext';
import { Attachments } from '../../components/Attachments';
import { approvalTypeLabel } from '../../lib/constants';
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
  const { assets, assetById, customerById, childrenOf, locationById, approvalByAsset } = useData();
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
        // Urut menurut tanggal efektif transaksi, lalu waktu pencatatan.
        const when = (m: Movement) => `${m.transactionDate || ''}|${String(m.timestamp?.toMillis() || 0).padStart(15, '0')}`;
        rows.sort((a, b) => when(b).localeCompare(when(a)));
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
  const location = asset.currentLocationId ? locationById.get(asset.currentLocationId) : undefined;
  const maps = location ? mapsUrl(location) : null;
  const warrantyLeft = asset.warrantyUntil ? Math.floor((new Date(asset.warrantyUntil).getTime() - Date.now()) / 86_400_000) : null;
  // Lama tiap tahap = jarak ke transaksi berikutnya (yang terbaru: sampai hari ini).
  const effectiveDate = (m: Movement) => m.transactionDate || m.timestamp?.toDate().toISOString();
  const stageDays = (history || []).map((m, i, list) => daysBetween(effectiveDate(m), i === 0 ? new Date() : effectiveDate(list[i - 1])));

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
        {approvalByAsset.get(asset.id) && (() => {
          const approval = approvalByAsset.get(asset.id)!;
          return (
            <button onClick={() => { onClose(); go('approvals', { tab: 'open' }); }} className="w-full text-left p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 font-medium">
              Unit ini sedang dalam pengajuan <b>{approvalTypeLabel(approval.type)}</b> ({approval.status === 'Pending' ? 'menunggu persetujuan' : 'disetujui, menunggu eksekusi'}) oleh {approval.requestedByName}. Pergerakan lain dikunci sampai selesai. Lihat →
            </button>
          );
        })()}
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
            <Row label={location?.type === 'Merchant Site' ? 'Merchant' : 'Lokasi'}>
              {locationLabel(asset)}{location?.merchantCode ? ` (${location.merchantCode})` : ''}
            </Row>
            {location && (
              <>
                <Row label="Alamat">{location.address}</Row>
                <Row label="Kota / Provinsi">{[location.city, location.province, location.postalCode].filter(Boolean).join(', ')}</Row>
                <Row label="Region">{location.region}</Row>
                {(location.picName || location.picPhone) && <Row label="PIC">{[location.picName, location.picPhone].filter(Boolean).join(' · ')}</Row>}
                {maps && (
                  <a href={maps} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-brand-primary hover:underline flex items-center gap-1">
                    Buka di Google Maps <ExternalLink size={11} />
                  </a>
                )}
              </>
            )}
            <Row label="Di Status Ini">{formatDuration(daysBetween(asset.statusSince || asset.updatedAt))}</Row>

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

        {asset.assetType === 'perangkat' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
            <section className="space-y-3">
              <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em]">Pengadaan</p>
              <Row label="Asset Tag">{asset.assetTag}</Row>
              <Row label="Supplier">{asset.supplierName}</Row>
              <Row label="No. PO / Surat Jalan">{[asset.poNumber, asset.deliveryNoteNo].filter(Boolean).join(' / ')}</Row>
              <Row label="Tanggal Terima">{formatDate(asset.receivedDate)}</Row>
              <Row label="Harga Beli">{asset.purchasePrice != null ? formatIDR(asset.purchasePrice) : '-'}</Row>
              <Row label="Garansi">
                {asset.warrantyUntil ? (
                  <span className={cn(warrantyLeft != null && warrantyLeft < 0 ? 'text-red-600' : warrantyLeft != null && warrantyLeft <= 30 ? 'text-amber-600' : '')}>
                    s/d {formatDate(asset.warrantyUntil)}{warrantyLeft != null && warrantyLeft < 0 ? ' (habis)' : ''}
                  </span>
                ) : '-'}
              </Row>
              <Row label="Umur Aset">{formatDuration(daysBetween(asset.receivedDate || asset.createdAt))}</Row>
            </section>
            <section className="space-y-3">
              <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em]">Operasional</p>
              <Row label="Koneksi">{asset.connectionType}</Row>
              <Row label="Tanggal Pasang">{formatDate(asset.installedDate)}</Row>
              <Row label="Kunjungan Terakhir">{formatDate(asset.lastVisitDate)}</Row>
              <Row label="Teknisi Terakhir">{asset.lastTechnician}</Row>
              <Row label="Jumlah Perbaikan">{asset.repairCount ? `${asset.repairCount}x` : '-'}</Row>
              <Row label="Biaya Perbaikan">{asset.repairCostTotal ? formatIDR(asset.repairCostTotal) : '-'}</Row>
              {asset.disposalMethod && <Row label="Penghapusan">{asset.disposalMethod} · {formatDate(asset.disposalDate)}{asset.disposalValue ? ` · ${formatIDR(asset.disposalValue)}` : ''}</Row>}
            </section>
          </div>
        )}

        <section className="p-4 border border-brand-border rounded-xl">
          <Attachments parentType="asset" parentId={asset.id} expanded title="Dokumen Unit" defaultLabel="Invoice / dokumen pembelian" hint="Mis. invoice, kartu garansi, foto kondisi unit." />
        </section>

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
          <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em]">Timeline Siklus Hidup</p>
          {history === null ? (
            <div className="flex justify-center py-6 text-brand-text-muted"><Spinner /></div>
          ) : history.length === 0 ? (
            <p className="text-xs text-brand-text-muted italic py-4 text-center border border-dashed border-brand-border rounded-xl">
              {asset.parentDeviceId ? 'Riwayat tercatat pada perangkat induknya.' : 'Belum ada riwayat.'}
            </p>
          ) : (
            <ol className="relative border-l-2 border-brand-border ml-2 space-y-3">
              {history.map((move, i) => (
                <li key={move.id} className="ml-5 relative">
                  <span
                    className="absolute -left-[27px] top-3 w-3 h-3 rounded-full border-2 border-white"
                    style={{ background: statusMeta(move.toStatus).chart }}
                    aria-hidden="true"
                  />
                  <div className="flex items-start justify-between gap-3 p-3 bg-gray-50/60 rounded-xl border border-brand-border">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-brand-text-main">{movementLabel(move.type)}</span>
                        <ArrowRight size={10} className="text-gray-400" />
                        <StatusBadge status={move.toStatus} />
                        {stageDays[i] != null && (
                          <span className="text-[10px] font-bold text-brand-text-muted" title={i === 0 ? 'Sampai hari ini' : 'Sampai transaksi berikutnya'}>
                            · {formatDuration(stageDays[i])}{i === 0 ? ' (sekarang)' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-brand-text-muted font-bold">
                        {formatDate(move.transactionDate || move.timestamp, 'dd MMM yyyy')} · {move.userName || 'System'}
                        {[move.customerName, move.toLocationName].filter(Boolean).length ? ` · ${[move.customerName, move.toLocationName].filter(Boolean).join(' · ')}` : ''}
                      </p>
                      {movementDetailText(move) && <p className="text-[11px] text-brand-text-main">{movementDetailText(move)}</p>}
                      {(move.penaltyAmount || 0) + (move.partPenaltyAmount || 0) > 0 && (
                        <p className="text-[11px] font-bold text-red-600">Denda {formatIDR((move.penaltyAmount || 0) + (move.partPenaltyAmount || 0))}</p>
                      )}
                      {move.notes && <p className="text-[11px] text-brand-text-muted italic">"{move.notes}"</p>}
                      <Attachments parentType="movement" parentId={move.id} defaultLabel={move.baGenerated ? 'BA bertanda tangan' : 'Foto unit / instalasi'} />
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
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Modal>
  );
}
