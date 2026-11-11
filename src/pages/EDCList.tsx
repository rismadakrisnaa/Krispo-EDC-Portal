import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Box, CheckSquare, Download, Edit2, Eye, FileUp, Filter, Hash, Package, Plus, Smartphone, Square, Tag, Trash2, X, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { describeError } from '../lib/firebase';
import { ALL_STATUSES, ASSET_TYPE_LABEL, CONDITIONS, SIM_TYPES, STATUS_GROUPS, matchesStatusFilter, statusMeta, type AssetType } from '../lib/constants';
import { contractHealth } from '../lib/contract';
import { deleteAssets, deleteBlocker } from '../lib/assets';
import { writeExcel } from '../lib/excel';
import { cn, formatDate, locationLabel, matchesSearch } from '../lib/utils';
import type { Asset } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useNav } from '../context/NavContext';
import { EmptyState, PageHeader, Pagination, StatusBadge, btnPrimary, btnSecondary, inputClass, useFeedback } from '../components/ui';
import { AssetFormModal } from './assets/AssetFormModal';
import { AssetImportModal } from './assets/AssetImportModal';
import { AssetDetailModal } from './assets/AssetDetailModal';

const PAGE_SIZE = 50;

const SECTIONS: { id: AssetType; sub: string; icon: React.ElementType }[] = [
  { id: 'perangkat', sub: 'EDC, Soundbox, dll', icon: Smartphone },
  { id: 'sim', sub: 'Kartu SIM', icon: Zap },
  { id: 'peripheral', sub: 'Charger, Battery, Modem', icon: Box },
];

const defaultFilters = { status: 'All', customer: 'All', vendor: 'All', condition: 'All', provider: 'All', simType: 'All' };

export function EDCList() {
  const { assets, customers, childrenOf } = useData();
  const { can } = useAuth();
  const { params, go, startMovement } = useNav();
  const { toast, confirm } = useFeedback();

  const [section, setSection] = useState<AssetType>('perangkat');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formState, setFormState] = useState<{ open: boolean; asset: Asset | null }>({ open: false, asset: null });
  const [showImport, setShowImport] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Filter dari URL (mis. klik kartu dashboard atau "Lihat Aset" di customer).
  useEffect(() => {
    if (params.section && SECTIONS.some(s => s.id === params.section)) setSection(params.section as AssetType);
    setSearch(params.q || '');
    setFilters({ ...defaultFilters, status: params.status || 'All', customer: params.customer || 'All' });
    setShowFilters(!!(params.status || params.customer));
    setSelectedIds([]);
    setPage(1);
  }, [params]);

  const inSection = useMemo(() => assets.filter(a => a.assetType === section), [assets, section]);

  const filtered = useMemo(() => inSection.filter(a =>
    matchesSearch(search, a.sn, a.vendor, a.model, a.tid, a.mid, a.customerName, a.provider, a.msisdn, a.parentDeviceSN, a.peripheralType) &&
    matchesStatusFilter(filters.status, a.status) &&
    (filters.customer === 'All' || a.currentCustomerId === filters.customer) &&
    (filters.vendor === 'All' || a.vendor === filters.vendor) &&
    (filters.condition === 'All' || a.condition === filters.condition) &&
    (filters.provider === 'All' || a.provider === filters.provider) &&
    (filters.simType === 'All' || a.simType === filters.simType),
  ), [inSection, search, filters]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeFilterCount = Object.values(filters).filter(v => v !== 'All').length;
  const vendors = useMemo(() => Array.from(new Set<string>(inSection.map(a => a.vendor || '').filter(Boolean))).sort(), [inSection]);
  const providers = useMemo(() => Array.from(new Set<string>(inSection.map(a => a.provider || '').filter(Boolean))).sort(), [inSection]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { perangkat: 0, sim: 0, peripheral: 0 };
    for (const a of assets) c[a.assetType] = (c[a.assetType] || 0) + 1;
    return c;
  }, [assets]);

  const setFilter = (key: keyof typeof defaultFilters) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters(prev => ({ ...prev, [key]: e.target.value }));
    setPage(1);
  };
  const changeSection = (next: AssetType) => {
    setSection(next);
    setSelectedIds([]);
    setFilters(prev => ({ ...defaultFilters, status: prev.status, customer: prev.customer }));
    setPage(1);
  };
  const resetFilters = () => {
    setFilters(defaultFilters);
    setSearch('');
    setPage(1);
    if (Object.keys(params).length) go('inventory');
  };

  // Seleksi berlaku untuk semua hasil filter, bukan hanya halaman yang tampil.
  const allSelected = filtered.length > 0 && filtered.every(a => selectedIds.includes(a.id));
  const toggleAll = () => setSelectedIds(allSelected ? [] : filtered.map(a => a.id));
  const toggleOne = (id: string) => setSelectedIds(prev => (prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]));
  const selectedAssets = useMemo(() => assets.filter(a => selectedIds.includes(a.id)), [assets, selectedIds]);

  async function handleDelete(targets: Asset[]) {
    const blocked = targets.filter(deleteBlocker);
    if (blocked.length) {
      toast(`${blocked.length} aset tidak bisa dihapus (mis. ${blocked[0].sn}: ${deleteBlocker(blocked[0])}). Selesaikan dulu lewat menu Pergerakan.`, 'error');
      return;
    }
    const linked = targets.reduce((n, a) => n + childrenOf(a.id).length, 0);
    const ok = await confirm({
      title: 'Hapus aset?', danger: true, confirmLabel: 'Ya, Hapus',
      message: (
        <>
          {targets.length === 1 ? <>Aset <b>{targets[0].sn}</b></> : <><b>{targets.length} aset</b></>} akan dihapus permanen.
          {linked > 0 && <> {linked} SIM / peripheral yang tertaut dilepas dan kembali menjadi stok.</>} Riwayat pergerakannya tetap tersimpan.
        </>
      ),
    });
    if (!ok) return;
    try {
      await deleteAssets(targets, assets);
      setSelectedIds(prev => prev.filter(id => !targets.some(t => t.id === id)));
      toast(`${targets.length} aset dihapus.`);
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    }
  }

  async function handleExport() {
    if (filtered.length === 0) return toast('Tidak ada data untuk diexport.', 'info');
    const rows = filtered.map(a => {
      const base = { 'Serial Number': a.sn, Status: statusMeta(a.status).label, Customer: a.customerName || '(Gudang)', Lokasi: locationLabel(a), 'Update Terakhir': formatDate(a.updatedAt, 'yyyy-MM-dd HH:mm') };
      if (section === 'sim') return { ICCID: a.sn, Provider: a.provider || '', MSISDN: a.msisdn || '', 'Jenis SIM': a.simType || '', 'SN Perangkat': a.parentDeviceSN || '', ...base };
      if (section === 'peripheral') return { ...base, Jenis: a.peripheralType || '', Merk: a.vendor || '', Model: a.model || '', 'SN Perangkat': a.parentDeviceSN || '' };
      const linked = childrenOf(a.id);
      const contract = contractHealth(a);
      return {
        ...base, Merk: a.vendor || '', Model: a.model || '', TID: a.tid || '', MID: a.mid || '', 'OS Version': a.osVersion || '', Kondisi: a.condition || '', IMEI: a.imei || '',
        SIM: linked.filter(c => c.assetType === 'sim').map(c => c.sn).join(', '),
        Peripheral: linked.filter(c => c.assetType === 'peripheral').map(c => `${c.peripheralType} ${c.sn}`).join(', '),
        'Status Kontrak': a.contractStatus || '', 'Akhir Kontrak': contract.effectiveEnd ? formatDate(contract.effectiveEnd, 'yyyy-MM-dd') : '',
      };
    });
    try {
      await writeExcel(rows, ASSET_TYPE_LABEL[section], `Aset_${section}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
    } catch (error) {
      toast(describeError(error), 'error');
    }
  }

  const customerFilterName = filters.customer !== 'All' ? customers.find(c => c.id === filters.customer)?.name : null;

  return (
    <div className="space-y-5">
      <PageHeader icon={Smartphone} title="Aset & Monitoring" subtitle="Master aset, posisi unit, dan status terkini">
        <button onClick={handleExport} className={btnSecondary}><Download size={16} /> Export</button>
        {can('assets.create') && (
          <>
            <button onClick={() => setShowImport(true)} className={btnSecondary}><FileUp size={16} /> Import</button>
            <button onClick={() => setFormState({ open: true, asset: null })} className={btnPrimary}><Plus size={16} /> Tambah {ASSET_TYPE_LABEL[section]}</button>
          </>
        )}
      </PageHeader>

      <div className="flex bg-white rounded-xl border border-brand-border p-1 gap-1">
        {SECTIONS.map(s => (
          <button
            key={s.id} onClick={() => changeSection(s.id)} aria-pressed={section === s.id}
            className={cn('flex-1 flex flex-col items-center py-2.5 rounded-lg transition-all', section === s.id ? 'bg-brand-primary text-white shadow-lg shadow-blue-100' : 'text-brand-text-muted hover:bg-gray-50')}
          >
            <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider"><s.icon size={16} />{ASSET_TYPE_LABEL[s.id]} ({counts[s.id] || 0})</span>
            <span className={cn('text-[9px] font-bold uppercase tracking-tight hidden sm:block', section === s.id ? 'text-white/60' : 'text-brand-text-muted/60')}>{s.sub}</span>
          </button>
        ))}
      </div>

      {selectedIds.length > 0 && (
        <div className="bg-brand-primary text-white px-4 py-3 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-lg shadow-blue-100">
          <span className="text-sm font-bold">{selectedIds.length} aset dipilih</span>
          <div className="flex flex-wrap items-center gap-2">
            {section === 'perangkat' && can('movements.create') && (
              <button onClick={() => startMovement(selectedIds)} className="px-4 py-1.5 bg-white text-brand-primary rounded-lg text-xs font-black uppercase tracking-wide flex items-center gap-2">
                <ArrowLeftRight size={14} /> Proses Pergerakan
              </button>
            )}
            {can('delete') && (
              <button onClick={() => handleDelete(selectedAssets)} className="px-4 py-1.5 bg-red-500 text-white rounded-lg text-xs font-black uppercase tracking-wide flex items-center gap-2 hover:bg-red-600">
                <Trash2 size={14} /> Hapus
              </button>
            )}
            <button onClick={() => setSelectedIds([])} className="px-3 py-1.5 text-xs font-bold hover:bg-white/10 rounded-lg">Batal</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-brand-border overflow-hidden flex flex-col min-h-[420px]">
        <div className="px-5 py-3.5 border-b border-brand-border flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-bold text-brand-text-muted">
            <span className="text-brand-primary font-black">{filtered.length}</span> dari {inSection.length} {ASSET_TYPE_LABEL[section].toLowerCase()}
            {customerFilterName && (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-brand-primary bg-brand-primary-light px-2 py-0.5 rounded-full border border-brand-primary/20">
                Customer: {customerFilterName}
                <button aria-label="Hapus filter customer" onClick={() => { setFilters(prev => ({ ...prev, customer: 'All' })); if (params.customer) go('inventory'); }}><X size={10} /></button>
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters(v => !v)} aria-expanded={showFilters}
              className={cn('px-3 py-1.5 border rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2', showFilters || activeFilterCount ? 'bg-brand-primary text-white border-brand-primary' : 'bg-white text-brand-text-muted border-brand-border hover:bg-gray-50')}
            >
              <Filter size={14} /> Filter{activeFilterCount > 0 && ` (${activeFilterCount})`}
            </button>
            <input
              type="search" aria-label="Cari aset" className={cn(inputClass, 'py-1.5 text-xs w-56')}
              placeholder={section === 'sim' ? 'Cari ICCID, MSISDN, provider...' : 'Cari SN, TID, MID, merk, customer...'}
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {showFilters && (
          <div className="bg-[#F8FAFC] border-b border-brand-border p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <label className="space-y-1">
              <span className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Status</span>
              <select className={cn(inputClass, 'bg-white py-2 text-xs')} value={filters.status} onChange={setFilter('status')}>
                <option value="All">Semua status</option>
                {Object.entries(STATUS_GROUPS).map(([key, group]) => <option key={key} value={key}>{group.label}</option>)}
                <optgroup label="Status spesifik">
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{statusMeta(s).label}</option>)}
                </optgroup>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Customer</span>
              <select className={cn(inputClass, 'bg-white py-2 text-xs')} value={filters.customer} onChange={setFilter('customer')}>
                <option value="All">Semua customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {section !== 'sim' && (
              <label className="space-y-1">
                <span className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Merk</span>
                <select className={cn(inputClass, 'bg-white py-2 text-xs')} value={filters.vendor} onChange={setFilter('vendor')}>
                  <option value="All">Semua merk</option>
                  {vendors.map(v => <option key={v}>{v}</option>)}
                </select>
              </label>
            )}
            {section === 'perangkat' && (
              <label className="space-y-1">
                <span className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Kondisi</span>
                <select className={cn(inputClass, 'bg-white py-2 text-xs')} value={filters.condition} onChange={setFilter('condition')}>
                  <option value="All">Semua kondisi</option>
                  {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
            )}
            {section === 'sim' && (
              <>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Provider</span>
                  <select className={cn(inputClass, 'bg-white py-2 text-xs')} value={filters.provider} onChange={setFilter('provider')}>
                    <option value="All">Semua provider</option>
                    {providers.map(p => <option key={p}>{p}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Jenis SIM</span>
                  <select className={cn(inputClass, 'bg-white py-2 text-xs')} value={filters.simType} onChange={setFilter('simType')}>
                    <option value="All">Semua jenis</option>
                    {SIM_TYPES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
              </>
            )}
            <button onClick={resetFilters} className="text-[11px] font-bold text-brand-primary uppercase hover:underline text-left pb-2.5">Reset filter</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] text-[11px] font-bold text-brand-text-muted uppercase tracking-wider">
                <th className="px-4 py-3 w-10 border-b border-brand-border">
                  <button onClick={toggleAll} aria-label="Pilih semua hasil filter" className="p-1 hover:text-brand-primary">
                    {allSelected ? <CheckSquare size={16} className="text-brand-primary" /> : <Square size={16} />}
                  </button>
                </th>
                <th className="px-4 py-3 border-b border-brand-border">{section === 'sim' ? 'ICCID' : 'Serial Number'}</th>
                <th className="px-4 py-3 border-b border-brand-border">{section === 'sim' ? 'Provider / MSISDN' : section === 'peripheral' ? 'Jenis / Merk' : 'Merk / Model'}</th>
                <th className="px-4 py-3 border-b border-brand-border">{section === 'perangkat' ? 'TID / MID' : 'Perangkat Induk'}</th>
                <th className="px-4 py-3 border-b border-brand-border">Customer / Lokasi</th>
                <th className="px-4 py-3 border-b border-brand-border">Status</th>
                <th className="px-4 py-3 border-b border-brand-border text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {pageRows.map(a => {
                const linked = section === 'perangkat' ? childrenOf(a.id).length : 0;
                return (
                  <tr key={a.id} className={cn('hover:bg-gray-50 transition-colors text-[13px]', selectedIds.includes(a.id) && 'bg-blue-50/40')}>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleOne(a.id)} aria-label={`Pilih ${a.sn}`} className="p-1 text-brand-text-muted hover:text-brand-primary">
                        {selectedIds.includes(a.id) ? <CheckSquare size={16} className="text-brand-primary" /> : <Square size={16} />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setDetailId(a.id)} className="font-bold text-brand-text-main hover:text-brand-primary text-left break-all">{a.sn}</button>
                      {linked > 0 && <span className="block text-[10px] text-brand-text-muted font-bold">+{linked} SIM / peripheral</span>}
                    </td>
                    <td className="px-4 py-3">
                      {section === 'sim' ? (
                        <><span className="block font-bold text-brand-text-main uppercase">{a.provider || '-'}</span><span className="text-[10px] text-brand-text-muted font-bold">MSISDN: {a.msisdn || '-'}</span></>
                      ) : section === 'peripheral' ? (
                        <><span className="block font-black text-brand-primary uppercase text-[11px]">{a.peripheralType || 'Peripheral'}</span><span className="text-[10px] text-brand-text-main font-bold uppercase">{[a.vendor, a.model].filter(Boolean).join(' ') || '-'}</span></>
                      ) : (
                        <><span className="block font-bold text-brand-text-main uppercase">{a.vendor || '-'}</span><span className="text-[10px] text-brand-text-muted font-bold uppercase">{a.model || '-'}</span></>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {section === 'perangkat' ? (
                        <div className="text-[10px] font-bold text-brand-text-muted uppercase space-y-0.5">
                          <span className="flex items-center gap-1"><Hash size={10} /> TID: <span className="text-brand-text-main">{a.tid || '-'}</span></span>
                          <span className="flex items-center gap-1"><Tag size={10} /> MID: <span className="text-brand-text-main">{a.mid || '-'}</span></span>
                        </div>
                      ) : a.parentDeviceId ? (
                        <button onClick={() => setDetailId(a.parentDeviceId!)} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded border border-indigo-100 flex items-center gap-1 hover:bg-indigo-100">
                          <Smartphone size={10} /> {a.parentDeviceSN}
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400 italic">Berdiri sendiri</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {a.currentCustomerId ? (
                        <button onClick={() => go('inventory', { customer: a.currentCustomerId!, section })} title="Filter aset customer ini" className="font-bold text-brand-primary hover:underline text-left">{a.customerName}</button>
                      ) : (
                        <span className="font-bold text-brand-text-main">(Gudang)</span>
                      )}
                      <span className="block text-[10px] text-brand-text-muted font-bold">{locationLabel(a)}</span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setDetailId(a.id)} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-brand-primary text-white text-[10px] font-bold uppercase rounded-lg hover:bg-brand-primary-dark">
                          <Eye size={12} /> Detail
                        </button>
                        {can('assets.update') && (
                          <button onClick={() => setFormState({ open: true, asset: a })} aria-label={`Edit ${a.sn}`} className="p-1.5 text-brand-text-muted hover:text-green-600 bg-white border border-brand-border rounded"><Edit2 size={14} /></button>
                        )}
                        {can('delete') && (
                          <button onClick={() => handleDelete([a])} aria-label={`Hapus ${a.sn}`} className="p-1.5 text-brand-text-muted hover:text-red-600 bg-white border border-brand-border rounded"><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <EmptyState
            icon={Package}
            title={inSection.length === 0 ? `Belum ada ${ASSET_TYPE_LABEL[section].toLowerCase()} terdaftar` : 'Tidak ada aset yang cocok dengan filter'}
            hint={inSection.length === 0 ? 'Tambahkan satu per satu atau import dari Excel.' : undefined}
            action={inSection.length > 0 ? <button onClick={resetFilters} className={btnSecondary}>Reset filter</button> : undefined}
          />
        )}
        <div className="mt-auto"><Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} /></div>
      </div>

      <AssetFormModal open={formState.open} asset={formState.asset} assetType={section} onClose={() => setFormState({ open: false, asset: null })} />
      <AssetImportModal open={showImport} assetType={section} onClose={() => setShowImport(false)} />
      <AssetDetailModal assetId={detailId} onClose={() => setDetailId(null)} onEdit={asset => { setDetailId(null); setFormState({ open: true, asset }); }} />
    </div>
  );
}
