import React, { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { format } from 'date-fns';
import { AlertCircle, ArrowLeftRight, ArrowRight, ClipboardList, FileCheck, History, Search, User, X } from 'lucide-react';
import { auth, db, describeError } from '../lib/firebase';
import { MOVEMENT_RULES, movementLabel, movementRule, statusMeta, type MovementType } from '../lib/constants';
import { checkEligibility, executeMovement, redownloadBA, resolveCustomer, terminationFor, withdrawalDateProblem } from '../lib/movements';
import { cn, formatDate, formatIDR, matchesSearch } from '../lib/utils';
import type { Movement, Part } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useNav } from '../context/NavContext';
import { EmptyState, Field, Modal, PageHeader, StatusBadge, btnPrimary, btnSecondary, inputClass, useFeedback } from '../components/ui';

const HISTORY_PAGE = 50;
const today = () => format(new Date(), 'yyyy-MM-dd');

export function MovementPage() {
  const { assets, customers, locations, parts, assetById, customerById, childrenOf } = useData();
  const { can } = useAuth();
  const { movementSeed, clearMovementSeed } = useNav();
  const { toast } = useFeedback();
  const canMove = can('movements.create');

  // ---------------- Form ----------------
  const [type, setType] = useState<MovementType>('Install');
  const [toStatus, setToStatus] = useState(movementRule('Install')!.to[0]);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [transactionDate, setTransactionDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [picName, setPicName] = useState('');
  const [technicianName, setTechnicianName] = useState(auth.currentUser?.displayName || '');
  const [damaged, setDamaged] = useState<Record<string, string[]>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const rule = movementRule(type)!;

  // Unit yang dipilih dari menu Aset.
  useEffect(() => {
    if (!movementSeed) return;
    setAssetIds(movementSeed.assetIds);
    if (movementSeed.type && movementRule(movementSeed.type)) changeType(movementSeed.type as MovementType);
    clearMovementSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movementSeed]);

  function changeType(next: MovementType) {
    const nextRule = movementRule(next)!;
    setType(next);
    setToStatus(nextRule.to[0]);
    setLocationId('');
    if (nextRule.customer !== 'required') setCustomerId('');
  }

  const selected = useMemo(() => assetIds.map(id => assetById.get(id)).filter(Boolean) as typeof assets, [assetIds, assetById]);
  const { eligible, blocked } = useMemo(() => checkEligibility(rule, selected), [rule, selected]);
  const blockedReason = useMemo(() => new Map(blocked.map(b => [b.asset.id, b.reason])), [blocked]);

  const formCustomer = customerById.get(customerId) || null;
  const customer = resolveCustomer(rule, { customer: formCustomer, assets: eligible }, { childrenOf, customerById });

  // Unit yang dialokasikan / dikirim ke customer tertentu otomatis mengisi customer di form.
  useEffect(() => {
    if (rule.customer !== 'required' || customerId) return;
    const holder = selected.find(a => a.currentCustomerId)?.currentCustomerId;
    if (holder && customerById.has(holder)) setCustomerId(holder);
  }, [rule, selected, customerId, customerById]);

  const locationOptions = useMemo(() => {
    if (!rule.locationType) return [];
    const list = locations.filter(l => l.type === rule.locationType);
    if (rule.locationType !== 'Merchant Site' || !customer) return list;
    // Lokasi milik customer ini di atas, lokasi tanpa customer tetap bisa dipilih.
    return list.filter(l => !l.customerId || l.customerId === customer.id);
  }, [rule, locations, customer]);

  useEffect(() => {
    if (locationId && !locationOptions.some(l => l.id === locationId)) setLocationId('');
    // Gudang / service center tunggal langsung terpilih.
    if (!locationId && rule.locationType && rule.locationType !== 'Merchant Site' && locationOptions.length === 1) setLocationId(locationOptions[0].id);
  }, [locationOptions, locationId, rule]);

  const suggestions = useMemo(() => {
    if (!search.trim()) return [];
    return assets
      .filter(a => a.assetType === 'perangkat' && !assetIds.includes(a.id) && matchesSearch(search, a.sn, a.tid, a.mid, a.customerName))
      .sort((a, b) => Number(rule.from.includes(b.status)) - Number(rule.from.includes(a.status)))
      .slice(0, 30);
  }, [assets, assetIds, search, rule]);

  function addBySerials(text: string) {
    const serials = text.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (serials.length === 0) return;
    const bySn = new Map(assets.filter(a => a.assetType === 'perangkat').map(a => [a.sn.toLowerCase(), a.id]));
    const found: string[] = [];
    const missing: string[] = [];
    for (const sn of serials) {
      const id = bySn.get(sn);
      if (!id) missing.push(sn);
      else if (!assetIds.includes(id) && !found.includes(id)) found.push(id);
    }
    if (found.length) setAssetIds(prev => [...prev, ...found]);
    setSearch('');
    if (missing.length) toast(`${found.length} unit ditambahkan. ${missing.length} SN tidak ditemukan: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', ...' : ''}`, found.length ? 'info' : 'error');
  }

  // ---------------- Ringkasan denda (Withdrawal) ----------------
  const partById = useMemo(() => new Map(parts.map(p => [p.id, p])), [parts]);
  const penaltyPreview = useMemo(() => {
    if (type !== 'Withdrawal') return null;
    const txDate = new Date(transactionDate);
    const rows = eligible.map(asset => {
      const termination = isNaN(txDate.getTime()) ? null : terminationFor(asset, customer, txDate);
      const partPenalty = (damaged[asset.id] || []).reduce((sum, id) => sum + (Number(partById.get(id)?.price) || 0), 0);
      return { asset, termination, partPenalty };
    });
    return { rows, total: rows.reduce((sum, r) => sum + (r.termination?.penaltyAmount || 0) + r.partPenalty, 0) };
  }, [type, eligible, transactionDate, damaged, partById, customer]);

  const togglePart = (assetId: string, partId: string) =>
    setDamaged(prev => {
      const current = prev[assetId] || [];
      return { ...prev, [assetId]: current.includes(partId) ? current.filter(id => id !== partId) : [...current, partId] };
    });

  // ---------------- Validasi & eksekusi ----------------
  const problems: string[] = [];
  if (assetIds.length === 0) problems.push('Pilih minimal satu unit.');
  if (blocked.length > 0) problems.push(`${blocked.length} unit tidak bisa diproses untuk "${rule.label}". Hapus unit bertanda merah.`);
  if (rule.customer === 'required' && !formCustomer) problems.push('Pilih customer.');
  if (!transactionDate) problems.push('Isi tanggal transaksi.');
  else if (transactionDate > today()) problems.push('Tanggal transaksi tidak boleh di masa depan.');
  const dateProblem = type === 'Withdrawal' && transactionDate ? withdrawalDateProblem(eligible, transactionDate) : null;
  if (dateProblem) problems.push(dateProblem);
  if (type === 'Install' && formCustomer && !(Number(formCustomer.value) > 0)) {
    problems.push(`Nilai sewa customer "${formCustomer.name}" masih Rp 0. Isi dulu di Master Customer supaya kontrak & denda terhitung benar.`);
  }

  function resetForm() {
    setAssetIds([]);
    setNotes('');
    setDamaged({});
    setPicName('');
    setLocationId('');
    setTransactionDate(today());
    setShowConfirm(false);
  }

  async function handleExecute() {
    setBusy(true);
    try {
      const result = await executeMovement(
        {
          type, toStatus, assets: eligible, customer: formCustomer,
          location: locations.find(l => l.id === locationId) || null,
          transactionDate, notes, picName, technicianName,
          damagedParts: Object.fromEntries((Object.entries(damaged) as [string, string[]][]).map(([id, ids]) => [id, ids.map(p => partById.get(p)).filter(Boolean) as Part[]])),
        },
        { childrenOf, customerById },
      );
      toast(
        `${rule.label}: ${result.count} unit berhasil diproses.` +
          (result.baNumber ? `\nBerita Acara ${result.baNumber} diunduh.` : '') +
          (result.totalPenalty > 0 ? `\nTotal denda: ${formatIDR(result.totalPenalty)}` : ''),
      );
      resetForm();
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---------------- Riwayat ----------------
  const [movements, setMovements] = useState<Movement[]>([]);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [historySearch, setHistorySearch] = useState('');
  const [historyType, setHistoryType] = useState('All');

  useEffect(() => {
    const q = query(collection(db, 'movements'), orderBy('timestamp', 'desc'), limit(historyLimit));
    return onSnapshot(q, snap => setMovements(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Movement)), err => console.error(err));
  }, [historyLimit]);

  const filteredHistory = movements.filter(m => {
    const sn = m.sn || assetById.get(m.edcId)?.sn;
    return (historyType === 'All' || m.type === historyType) && matchesSearch(historySearch, sn, m.customerName, m.userName, m.baNumber, m.notes);
  });
  const historyTypes = Array.from(new Set<string>(movements.map(m => m.type))).sort();

  async function handleDownloadBA(move: Movement) {
    try {
      await redownloadBA(move, assetById, customerById);
    } catch (error) {
      toast(describeError(error), 'error');
    }
  }

  const needsPic = rule.ba && !!customer;
  const confirmBlocked = busy || (needsPic && !picName.trim()) || (rule.ba && !technicianName.trim());

  return (
    <div className="space-y-6">
      <PageHeader icon={ArrowLeftRight} title="Pergerakan EDC" subtitle="Semua perubahan status unit dicatat di sini" />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ---------------- Form ---------------- */}
        <div className="lg:col-span-2">
          {!canMove ? (
            <div className="bg-white p-6 rounded-xl border border-brand-border text-sm text-brand-text-muted">
              Role Anda hanya bisa melihat riwayat pergerakan.
            </div>
          ) : (
            <form
              onSubmit={e => { e.preventDefault(); if (problems.length === 0) setShowConfirm(true); }}
              className="bg-white p-6 rounded-xl border border-brand-border shadow-sm space-y-5"
            >
              <div className="font-bold text-xs text-brand-text-muted uppercase tracking-widest border-b border-brand-border pb-3">Transaksi Baru</div>

              <Field label="1. Jenis Pergerakan" hint={rule.description}>
                <select className={inputClass} value={type} onChange={e => changeType(e.target.value as MovementType)}>
                  {MOVEMENT_RULES.map(r => <option key={r.type} value={r.type}>{r.label}</option>)}
                </select>
              </Field>

              {rule.to.length > 1 && (
                <Field label="Status Akhir">
                  <select className={inputClass} value={toStatus} onChange={e => setToStatus(e.target.value)}>
                    {rule.to.map(s => <option key={s} value={s}>{statusMeta(s).label}</option>)}
                  </select>
                </Field>
              )}

              <div className="space-y-2">
                <span className="block text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">2. Unit ({assetIds.length})</span>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text" className={cn(inputClass, 'pl-9')} placeholder="Cari SN / TID, atau paste banyak SN sekaligus..."
                    value={search} onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBySerials(search); } }}
                    onPaste={e => {
                      const text = e.clipboardData.getData('text');
                      if (/[\s,;]/.test(text.trim())) { e.preventDefault(); addBySerials(text); }
                    }}
                  />
                  {suggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-brand-border rounded-lg shadow-xl max-h-[220px] overflow-y-auto">
                      {suggestions.map(a => {
                        const ok = rule.from.includes(a.status);
                        return (
                          <button
                            key={a.id} type="button"
                            onClick={() => { setAssetIds(prev => [...prev, a.id]); setSearch(''); }}
                            className={cn('w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0', !ok && 'opacity-50')}
                          >
                            <span className="font-bold text-brand-text-main truncate">{a.sn}</span>
                            <StatusBadge status={a.status} />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-[150px] overflow-y-auto">
                  {selected.map(a => {
                    const reason = blockedReason.get(a.id);
                    return (
                      <span
                        key={a.id} title={reason ? `Tidak bisa diproses: ${reason}` : statusMeta(a.status).label}
                        className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border', reason ? 'bg-red-50 text-red-700 border-red-200' : 'bg-brand-primary-light text-brand-primary border-brand-primary/20')}
                      >
                        {a.sn}
                        <button type="button" aria-label={`Hapus ${a.sn}`} onClick={() => setAssetIds(prev => prev.filter(id => id !== a.id))} className="hover:text-red-500"><X size={12} /></button>
                      </span>
                    );
                  })}
                  {assetIds.length === 0 && <p className="text-[11px] text-brand-text-muted italic py-1">Belum ada unit. Hanya unit berstatus {rule.from.map(s => statusMeta(s).label).join(' / ')} yang bisa diproses.</p>}
                </div>
                {blocked.length > 0 && (
                  <div className="flex items-start justify-between gap-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700 font-medium">
                    <span>{blocked.length} unit tidak sesuai: {blocked.slice(0, 3).map(b => `${b.asset.sn} (${b.reason})`).join('; ')}{blocked.length > 3 ? '; ...' : ''}</span>
                    <button type="button" className="font-black underline shrink-0" onClick={() => setAssetIds(eligible.map(a => a.id))}>Hapus</button>
                  </div>
                )}
              </div>

              {rule.customer === 'required' ? (
                <Field label="3. Customer">
                  <select className={inputClass} value={customerId} onChange={e => setCustomerId(e.target.value)} required>
                    <option value="">Pilih customer...</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              ) : rule.customer === 'keep' || rule.ba ? (
                <Field label="3. Customer">
                  <input className={inputClass} disabled value={customer?.name || (eligible.length ? '(tanpa customer)' : 'Otomatis dari unit yang dipilih')} />
                </Field>
              ) : null}

              {type === 'Install' && formCustomer && (
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-[11px] text-blue-800 leading-relaxed">
                  Kontrak per unit: <b>{formCustomer.scheme || 'Sewa'}</b>, {formatIDR(formCustomer.value)} / bulan, durasi <b>{formCustomer.contractDuration || 12} bulan</b> mulai tanggal transaksi.
                </div>
              )}

              {rule.locationType && (
                <Field
                  label={`Lokasi Tujuan (${rule.locationType})`}
                  hint={locationOptions.length === 0 ? `Belum ada lokasi bertipe ${rule.locationType} di Master Lokasi. Boleh dikosongkan.` : undefined}
                >
                  <select className={inputClass} value={locationId} onChange={e => setLocationId(e.target.value)}>
                    <option value="">{rule.locationType === 'Merchant Site' ? 'Alamat utama customer' : 'Tidak ditentukan'}</option>
                    {locationOptions.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </Field>
              )}

              <Field label="Tanggal Transaksi">
                <input type="date" required max={today()} className={inputClass} value={transactionDate} onChange={e => setTransactionDate(e.target.value)} />
              </Field>

              {type === 'Withdrawal' && penaltyPreview && eligible.length > 0 && (
                <div className="space-y-2">
                  <span className="block text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Checklist Part Hilang / Rusak per Unit</span>
                  {parts.length === 0 && <p className="text-[11px] text-brand-text-muted italic">Master Part masih kosong, denda part tidak dihitung.</p>}
                  <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                    {penaltyPreview.rows.map(({ asset, termination, partPenalty }) => (
                      <div key={asset.id} className="p-3 border border-brand-border rounded-lg space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-bold text-brand-text-main">{asset.sn}</span>
                          <span className={cn('font-bold', termination?.penaltyAmount ? 'text-red-600' : 'text-emerald-600')}>
                            {!termination ? 'Tanpa kontrak aktif' : termination.penaltyAmount ? `Early: ${termination.remainingMonthsAtTermination} bln = ${formatIDR(termination.penaltyAmount)}` : 'Kontrak selesai normal'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {parts.map(p => {
                            const on = (damaged[asset.id] || []).includes(p.id);
                            return (
                              <button
                                key={p.id} type="button" aria-pressed={on} onClick={() => togglePart(asset.id, p.id)}
                                className={cn('px-2 py-1 rounded border text-[10px] font-bold transition-colors', on ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-brand-border text-brand-text-muted hover:bg-gray-50')}
                              >
                                {p.name} · {formatIDR(p.price)}
                              </button>
                            );
                          })}
                        </div>
                        {partPenalty > 0 && <p className="text-[10px] font-bold text-orange-700">Denda part: {formatIDR(partPenalty)}</p>}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center px-3 py-2 bg-gray-50 rounded-lg text-xs font-black">
                    <span className="uppercase text-brand-text-muted">Total Denda</span>
                    <span className={penaltyPreview.total > 0 ? 'text-red-700' : 'text-brand-text-main'}>{formatIDR(penaltyPreview.total)}</span>
                  </div>
                </div>
              )}

              <Field label="Catatan">
                <textarea className={cn(inputClass, 'min-h-[70px]')} maxLength={1000} placeholder="Opsional" value={notes} onChange={e => setNotes(e.target.value)} />
              </Field>

              {assetIds.length > 0 && problems.length > 0 && (
                <ul className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 font-medium space-y-1">
                  {problems.map(p => <li key={p} className="flex gap-2"><AlertCircle size={13} className="shrink-0 mt-0.5" />{p}</li>)}
                </ul>
              )}

              <button type="submit" disabled={busy || problems.length > 0} className={cn(btnPrimary, 'w-full py-3')}>
                Lanjut: Konfirmasi {eligible.length > 0 && `(${eligible.length} unit)`}
                <ArrowRight size={16} />
              </button>
            </form>
          )}
        </div>

        {/* ---------------- Riwayat ---------------- */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-brand-text-muted uppercase tracking-widest flex items-center gap-2">
              <History size={16} className="text-brand-primary" />
              Riwayat Pergerakan
            </h2>
            <div className="flex gap-2">
              <select aria-label="Filter jenis" className={cn(inputClass, 'w-auto py-1.5 text-xs')} value={historyType} onChange={e => setHistoryType(e.target.value)}>
                <option value="All">Semua jenis</option>
                {historyTypes.map(t => <option key={t} value={t}>{movementLabel(t)}</option>)}
              </select>
              <input aria-label="Cari riwayat" className={cn(inputClass, 'w-44 py-1.5 text-xs')} placeholder="Cari SN, customer, BA..." value={historySearch} onChange={e => setHistorySearch(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2.5">
            {filteredHistory.map(move => (
              <div key={move.id} className="bg-white p-4 rounded-xl border border-brand-border shadow-sm flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 bg-brand-primary-light rounded-lg flex items-center justify-center text-brand-primary"><ClipboardList size={16} /></div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-bold text-brand-text-main text-sm truncate">{move.sn || assetById.get(move.edcId)?.sn || `ID ${move.edcId}`}</h4>
                    <span className="text-[10px] text-brand-text-muted font-bold shrink-0">{formatDate(move.timestamp, 'dd MMM yyyy HH:mm')}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold text-brand-text-main uppercase bg-gray-50 px-2 py-0.5 rounded border border-brand-border">{movementLabel(move.type)}</span>
                    {move.fromStatus && <><StatusBadge status={move.fromStatus} /><ArrowRight size={10} className="text-gray-300" /></>}
                    <StatusBadge status={move.toStatus} />
                    {move.transactionDate && <span className="text-[10px] font-bold text-brand-text-muted">Efektif {formatDate(move.transactionDate)}</span>}
                  </div>
                  {(move.customerName || move.toLocationName) && (
                    <p className="text-[11px] text-brand-text-main font-medium">{[move.customerName, move.toLocationName].filter(Boolean).join(' · ')}</p>
                  )}
                  {((move.penaltyAmount || 0) + (move.partPenaltyAmount || 0)) > 0 && (
                    <p className="text-[11px] font-bold text-red-600">Denda: {formatIDR((move.penaltyAmount || 0) + (move.partPenaltyAmount || 0))}</p>
                  )}
                  {move.notes && <p className="text-[11px] text-brand-text-muted italic">"{move.notes}"</p>}
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold text-brand-text-muted uppercase tracking-wide"><User size={10} />{move.userName || 'System'}</span>
                    {move.baGenerated && (
                      <button onClick={() => handleDownloadBA(move)} className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded text-[10px] font-black uppercase hover:bg-emerald-100">
                        <FileCheck size={11} />
                        {move.baNumber || 'Unduh BA'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {filteredHistory.length === 0 && (
              <div className="bg-white rounded-xl border border-brand-border"><EmptyState icon={History} title="Belum ada riwayat yang cocok" /></div>
            )}
            {movements.length >= historyLimit && (
              <button onClick={() => setHistoryLimit(n => n + HISTORY_PAGE)} className={cn(btnSecondary, 'w-full')}>Muat lebih banyak</button>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- Konfirmasi ---------------- */}
      <Modal open={showConfirm} onClose={() => setShowConfirm(false)} busy={busy} title={`Konfirmasi ${rule.label}`} subtitle={`${eligible.length} unit · efektif ${formatDate(transactionDate)}`}>
        <div className="p-6 space-y-5">
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-gray-50 rounded-lg border border-brand-border">
              <dt className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Customer</dt>
              <dd className="font-bold text-brand-text-main mt-0.5">{customer?.name || '-'}</dd>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg border border-brand-border">
              <dt className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Status Akhir</dt>
              <dd className="mt-1"><StatusBadge status={toStatus} /></dd>
            </div>
          </dl>

          <div className="border border-brand-border rounded-xl p-3 bg-gray-50/50 max-h-[150px] overflow-y-auto space-y-1.5">
            {eligible.map(a => {
              const linked = childrenOf(a.id);
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 bg-white px-2.5 py-1.5 rounded border border-brand-border text-xs">
                  <span className="font-bold">{a.sn}</span>
                  <span className="text-brand-text-muted truncate">{[a.vendor, a.model].filter(Boolean).join(' ')}{linked.length ? ` · +${linked.length} SIM/peripheral` : ''}</span>
                </div>
              );
            })}
          </div>

          {penaltyPreview && penaltyPreview.total > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 font-bold flex justify-between">
              <span>Total denda yang akan dicatat</span><span>{formatIDR(penaltyPreview.total)}</span>
            </div>
          )}

          {rule.ba ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label={`Nama PIC Customer${needsPic ? '' : ' (opsional)'}`}>
                <input className={inputClass} value={picName} placeholder={customer?.picName || ''} onChange={e => setPicName(e.target.value)} onFocus={() => !picName && customer?.picName && setPicName(customer.picName)} />
              </Field>
              <Field label="Nama Teknisi / Admin">
                <input className={inputClass} value={technicianName} onChange={e => setTechnicianName(e.target.value)} />
              </Field>
              <p className="col-span-2 text-[11px] text-brand-text-muted">Berita Acara (PDF) otomatis terunduh setelah transaksi tersimpan, dan bisa diunduh ulang dari riwayat.</p>
            </div>
          ) : (
            <p className="text-[11px] text-brand-text-muted">Pergerakan internal: dicatat di riwayat tanpa Berita Acara.</p>
          )}

          <div className="flex gap-3">
            <button type="button" disabled={busy} onClick={() => setShowConfirm(false)} className={cn(btnSecondary, 'flex-1 py-3')}>Kembali</button>
            <button type="button" disabled={confirmBlocked} onClick={handleExecute} className={cn(btnPrimary, 'flex-1 py-3')}>
              {busy ? 'Memproses...' : 'Simpan Pergerakan'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
