import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Eye, RefreshCw, RotateCcw, Search, ShieldAlert } from 'lucide-react';
import { describeError } from '../lib/firebase';
import { CONTRACT_STATUS, STATUS } from '../lib/constants';
import { contractHealth, type ContractHealth } from '../lib/contract';
import { cancelTermination } from '../lib/movements';
import { writeExcel } from '../lib/excel';
import { cn, formatDate, formatIDR, locationLabel, matchesSearch } from '../lib/utils';
import type { Asset } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useNav } from '../context/NavContext';
import { EmptyState, Modal, PageHeader, Pagination, StatusBadge, btnSecondary, inputClass, useFeedback } from '../components/ui';

const PAGE_SIZE = 50;

const HEALTH_META: Record<ContractHealth, { label: string; badge: string }> = {
  active: { label: 'Aktif', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  ending: { label: 'Segera Berakhir', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  aro: { label: 'Aktif (ARO)', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  terminated: { label: 'Diakhiri', badge: 'bg-red-50 text-red-700 border-red-200' },
  none: { label: '-', badge: 'bg-gray-50 text-gray-600 border-gray-200' },
};

const contractCustomer = (a: Asset) => a.contractCustomerName || a.customerName || '-';
const totalPenalty = (a: Asset) => (a.penaltyAmount || 0) + (a.partPenaltyAmount || 0);
/** Pengakhiran hanya bisa dibatalkan selama unit belum bergerak lagi sejak ditarik. */
const canCancel = (a: Asset) => a.contractStatus !== CONTRACT_STATUS.ACTIVE && a.status === STATUS.WITHDRAWN;

export function ContractList() {
  const { assets, childrenOf, customerById } = useData();
  const { can } = useAuth();
  const { params, go } = useNav();
  const { toast, confirm } = useFeedback();

  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<'all' | ContractHealth>('all');
  const [customerFilter, setCustomerFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setSearch(params.q || '');
    setCustomerFilter(params.customer || '');
    setHealthFilter((params.health as ContractHealth) || 'all');
    setPage(1);
  }, [params]);

  const rows = useMemo(
    () => assets.filter(a => a.assetType === 'perangkat' && a.contractStatus).map(a => ({ asset: a, ...contractHealth(a) })),
    [assets],
  );

  const summary = useMemo(() => {
    const live = rows.filter(r => r.health !== 'terminated');
    return {
      active: live.length,
      ending: rows.filter(r => r.health === 'ending').length,
      aro: rows.filter(r => r.health === 'aro').length,
      monthly: live.reduce((sum, r) => sum + (Number(r.asset.currentMonthlyRental) || 0), 0),
      penalties: rows.reduce((sum, r) => sum + totalPenalty(r.asset), 0),
      terminated: rows.filter(r => r.health === 'terminated').length,
    };
  }, [rows]);

  const filtered = useMemo(() => rows.filter(({ asset, health }) =>
    (healthFilter === 'all' || health === healthFilter) &&
    (!customerFilter || asset.contractCustomerId === customerFilter || asset.currentCustomerId === customerFilter) &&
    matchesSearch(search, asset.sn, asset.model, asset.vendor, asset.tid, asset.mid, contractCustomer(asset)),
  ), [rows, healthFilter, customerFilter, search]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const cancellable = filtered.filter(r => canCancel(r.asset)).map(r => r.asset.id);
  const allSelected = cancellable.length > 0 && cancellable.every(id => selectedIds.includes(id));
  const detail = rows.find(r => r.asset.id === detailId);

  async function handleCancel(targets: Asset[]) {
    const penalties = targets.reduce((sum, a) => sum + totalPenalty(a), 0);
    const ok = await confirm({
      title: 'Batalkan pengakhiran kontrak?',
      confirmLabel: 'Ya, Pulihkan Kontrak',
      message: (
        <>
          {targets.length === 1 ? <>Unit <b>{targets[0].sn}</b></> : <><b>{targets.length} unit</b></>} kembali berstatus <b>Terpasang</b> di customer kontraknya
          (beserta SIM / peripheral tertaut), kontrak aktif lagi, dan denda {formatIDR(penalties)} dihapus.
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const count = await cancelTermination(targets, { childrenOf, customerById });
      toast(`Kontrak ${count} unit dipulihkan.`);
      setSelectedIds([]);
      setDetailId(null);
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    if (filtered.length === 0) return toast('Tidak ada data untuk diexport.', 'info');
    try {
      await writeExcel(filtered.map(({ asset: a, effectiveEnd, isARO, health }) => ({
        'Serial Number': a.sn, Merk: a.vendor || '', Model: a.model || '', TID: a.tid || '', MID: a.mid || '',
        'Customer Kontrak': contractCustomer(a), Skema: a.contractScheme || '', 'Sewa / Bulan': a.currentMonthlyRental || 0,
        'Mulai Kontrak': formatDate(a.contractStartDate, 'yyyy-MM-dd'),
        'Akhir Kontrak (Asli)': formatDate(a.expectedEndDate, 'yyyy-MM-dd'),
        'Akhir Kontrak (Berlaku)': health === 'terminated' ? formatDate(a.contractEndDateActual, 'yyyy-MM-dd') : formatDate(effectiveEnd, 'yyyy-MM-dd'),
        ARO: isARO ? 'YA' : 'TIDAK', 'Status Kontrak': a.contractStatus || '',
        'Posisi Unit': a.status, Lokasi: locationLabel(a),
        'Sisa Bulan Saat Diakhiri': a.remainingMonthsAtTermination ?? '',
        'Denda Pengakhiran': a.penaltyAmount || 0, 'Denda Part': a.partPenaltyAmount || 0, 'Total Denda': totalPenalty(a),
        'Part Hilang / Rusak': (a.damagedParts || []).join(', '),
      })), 'Kontrak', `Monitoring_Kontrak_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      toast(describeError(error), 'error');
    }
  }

  const cards: { key: 'all' | ContractHealth; label: string; value: string; tone: string }[] = [
    { key: 'all', label: `Semua Kontrak · ${summary.active} berjalan`, value: rows.length.toLocaleString('id-ID'), tone: 'text-brand-text-main' },
    { key: 'ending', label: 'Berakhir ≤ 30 Hari', value: summary.ending.toLocaleString('id-ID'), tone: 'text-orange-600' },
    { key: 'aro', label: 'Masa ARO', value: summary.aro.toLocaleString('id-ID'), tone: 'text-indigo-600' },
    { key: 'terminated', label: `Diakhiri · Denda ${formatIDR(summary.penalties)}`, value: summary.terminated.toLocaleString('id-ID'), tone: 'text-red-600' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader icon={ShieldAlert} title="Monitoring Kontrak" subtitle={`Kontrak per unit · Nilai sewa berjalan ${formatIDR(summary.monthly)} / bulan`}>
        <button onClick={handleExport} className={btnSecondary}><Download size={16} /> Export</button>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(card => (
          <button
            key={card.key} onClick={() => { setHealthFilter(card.key); setPage(1); }} aria-pressed={healthFilter === card.key}
            className={cn('bg-white p-4 rounded-xl border text-left transition-all', healthFilter === card.key ? 'border-brand-primary ring-2 ring-brand-primary/10' : 'border-brand-border hover:border-brand-primary/50')}
          >
            <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest truncate">{card.label}</p>
            <p className={cn('text-2xl font-black tracking-tight mt-1', card.tone)}>{card.value}</p>
          </button>
        ))}
      </div>

      <div className="bg-white p-3 rounded-xl border border-brand-border flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted" size={16} />
          <input type="search" aria-label="Cari kontrak" className={cn(inputClass, 'pl-10')} placeholder="Cari SN, TID, model, atau customer..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        {customerFilter && (
          <button onClick={() => go('contracts')} className="text-[11px] font-bold text-brand-primary bg-brand-primary-light px-3 py-2 rounded-lg border border-brand-primary/20">
            Customer: {customerById.get(customerFilter)?.name || 'terpilih'} ✕
          </button>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="bg-brand-primary text-white p-4 rounded-xl flex items-center justify-between gap-3 shadow-lg shadow-blue-100">
          <p className="text-sm font-bold">{selectedIds.length} unit dipilih</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds([])} className="px-4 py-2 text-xs font-bold hover:bg-white/10 rounded-lg">Batal</button>
            <button
              disabled={busy} onClick={() => handleCancel(assets.filter(a => selectedIds.includes(a.id)))}
              className="px-5 py-2 bg-white text-brand-primary rounded-lg text-xs font-black uppercase tracking-wide flex items-center gap-2 disabled:opacity-50"
            >
              <RotateCcw size={14} className={busy ? 'animate-spin' : ''} /> Batalkan Pengakhiran
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-brand-border shadow-sm overflow-hidden flex flex-col min-h-[360px]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-[#F8FAFC] text-[11px] font-bold text-brand-text-muted uppercase tracking-wider">
                <th className="px-4 py-3 border-b border-brand-border w-10">
                  {can('movements.create') && cancellable.length > 0 && (
                    <input type="checkbox" aria-label="Pilih semua kontrak yang bisa dipulihkan" className="w-4 h-4" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : cancellable)} />
                  )}
                </th>
                <th className="px-4 py-3 border-b border-brand-border">Unit</th>
                <th className="px-4 py-3 border-b border-brand-border">Customer Kontrak</th>
                <th className="px-4 py-3 border-b border-brand-border">Posisi Unit</th>
                <th className="px-4 py-3 border-b border-brand-border">Masa Berlaku</th>
                <th className="px-4 py-3 border-b border-brand-border">Status Kontrak</th>
                <th className="px-4 py-3 border-b border-brand-border text-right">Denda</th>
                <th className="px-4 py-3 border-b border-brand-border text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {pageRows.map(({ asset: a, health, effectiveEnd, isARO, daysLeft }) => (
                <tr key={a.id} className={cn('hover:bg-gray-50/80 text-[13px]', selectedIds.includes(a.id) && 'bg-brand-primary-light')}>
                  <td className="px-4 py-3">
                    {can('movements.create') && canCancel(a) && (
                      <input
                        type="checkbox" aria-label={`Pilih ${a.sn}`} className="w-4 h-4" checked={selectedIds.includes(a.id)}
                        onChange={() => setSelectedIds(prev => (prev.includes(a.id) ? prev.filter(i => i !== a.id) : [...prev, a.id]))}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setDetailId(a.id)} className="font-bold text-brand-text-main hover:text-brand-primary">{a.sn}</button>
                    <span className="block text-[10px] text-brand-text-muted font-bold">{[a.vendor, a.model].filter(Boolean).join(' · ') || '-'} · TID {a.tid || '-'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-bold text-brand-text-main">{contractCustomer(a)}</span>
                    <span className="block text-[9px] font-bold text-brand-primary uppercase tracking-widest">{a.contractScheme || 'Sewa'} · {formatIDR(a.currentMonthlyRental)}/bln</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.status} />
                    <span className="block text-[10px] text-brand-text-muted font-bold mt-0.5 truncate max-w-[150px]">{locationLabel(a)}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="block text-[10px] font-bold text-brand-text-muted">Mulai {formatDate(a.contractStartDate)}</span>
                    {health === 'terminated' ? (
                      <span className="font-bold text-brand-text-main">Diakhiri {formatDate(a.contractEndDateActual)}</span>
                    ) : (
                      <>
                        <span className="font-bold text-brand-text-main">Akhir {formatDate(effectiveEnd)}</span>
                        <span className={cn('block text-[10px] font-bold', daysLeft <= 30 ? 'text-red-500' : 'text-brand-text-muted')}>
                          {daysLeft} hari lagi{isARO ? ` · asli ${formatDate(a.expectedEndDate)}` : ''}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tight border whitespace-nowrap', HEALTH_META[health].badge)}>
                      {health === 'terminated' ? (a.contractStatus === CONTRACT_STATUS.TERMINATED_EARLY ? 'Diakhiri (Early)' : 'Selesai Normal') : HEALTH_META[health].label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {totalPenalty(a) > 0 ? <span className="font-black text-red-700 text-xs">{formatIDR(totalPenalty(a))}</span> : <span className="text-brand-text-muted">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setDetailId(a.id)} aria-label={`Detail kontrak ${a.sn}`} className="p-1.5 text-brand-text-muted hover:text-brand-primary border border-brand-border rounded-lg"><Eye size={14} /></button>
                      {can('movements.create') && canCancel(a) && (
                        <button disabled={busy} onClick={() => handleCancel([a])} title="Batalkan pengakhiran" aria-label={`Batalkan pengakhiran ${a.sn}`} className="p-1.5 text-red-500 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50"><RotateCcw size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <EmptyState
            icon={AlertTriangle}
            title={rows.length === 0 ? 'Belum ada kontrak' : 'Tidak ada kontrak yang cocok'}
            hint={rows.length === 0 ? 'Kontrak terbentuk otomatis saat unit di-Install lewat menu Pergerakan EDC.' : undefined}
          />
        )}
        <div className="mt-auto"><Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} /></div>
      </div>

      <Modal open={!!detail} onClose={() => setDetailId(null)} busy={busy} title={detail?.asset.sn || ''} subtitle={`Kontrak · ${[detail?.asset.vendor, detail?.asset.model].filter(Boolean).join(' ')}`}>
        {detail && (() => {
          const a = detail.asset;
          const items: [string, React.ReactNode][] = [
            ['Customer Kontrak', contractCustomer(a)],
            ['Skema', a.contractScheme || 'Sewa'],
            ['Mulai Kontrak', formatDate(a.contractStartDate, 'dd MMMM yyyy')],
            [detail.health === 'terminated' ? 'Diakhiri' : 'Akhir Kontrak', formatDate(detail.health === 'terminated' ? a.contractEndDateActual : detail.effectiveEnd, 'dd MMMM yyyy')],
            ['Status Kontrak', a.contractStatus],
            ['Sewa / Bulan', formatIDR(a.currentMonthlyRental)],
          ];
          return (
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {items.map(([label, value]) => (
                  <div key={label} className="p-3 bg-gray-50 rounded-xl border border-brand-border">
                    <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-1">{label}</p>
                    <p className="text-sm font-bold text-brand-text-main">{value}</p>
                  </div>
                ))}
              </div>
              {detail.isARO && detail.health !== 'terminated' && (
                <p className="text-[11px] font-bold text-indigo-700 flex items-center gap-1.5"><RefreshCw size={12} /> Diperpanjang otomatis (ARO). Akhir kontrak asli: {formatDate(a.expectedEndDate)}.</p>
              )}
              {totalPenalty(a) > 0 && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-2 text-xs">
                  <div className="flex justify-between"><span className="font-bold text-red-800/70">Denda pengakhiran ({a.remainingMonthsAtTermination ?? '?'} bln sisa × sewa)</span><span className="font-black text-red-700">{formatIDR(a.penaltyAmount)}</span></div>
                  <div className="flex justify-between"><span className="font-bold text-orange-800/70">Denda part{a.damagedParts?.length ? `: ${a.damagedParts.join(', ')}` : ''}</span><span className="font-black text-orange-700">{formatIDR(a.partPenaltyAmount)}</span></div>
                  <div className="pt-2 border-t border-red-200 flex justify-between"><span className="font-black text-red-900 uppercase">Total Kewajiban</span><span className="font-black text-red-900 text-base">{formatIDR(totalPenalty(a))}</span></div>
                </div>
              )}
              {detail.health === 'terminated' && !canCancel(a) && (
                <p className="text-[11px] text-brand-text-muted">Unit sudah berpindah status sejak ditarik, sehingga pengakhiran kontrak ini tidak bisa dibatalkan lagi.</p>
              )}
              <div className="flex gap-3">
                <button onClick={() => { setDetailId(null); go('inventory', { q: a.sn }); }} className={cn(btnSecondary, 'flex-1 py-3')}>Lihat Aset</button>
                {can('movements.create') && canCancel(a) && (
                  <button disabled={busy} onClick={() => handleCancel([a])} className="flex-1 py-3 bg-red-50 text-red-600 text-sm font-bold rounded-lg hover:bg-red-100 border border-red-100 flex items-center justify-center gap-2 disabled:opacity-50">
                    <RotateCcw size={15} /> Batalkan Pengakhiran
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
