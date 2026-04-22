import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where, orderBy, doc, updateDoc, deleteField, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { FileText, Calendar, DollarSign, Clock, AlertTriangle, Search, Download, Eye, RefreshCw, Filter, Smartphone, ShieldAlert, X, RotateCcw } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { getAROExpectedEnd } from '../lib/utils';
import { cn } from '../lib/utils';

export function ContractList({ initialFilter }: { initialFilter?: string | null }) {
  const [edcs, setEdcs] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [showDetail, setShowDetail] = useState(false);
  const [selectedEdc, setSelectedEdc] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    // Listen to all EDCs that have been at least once in a contract
    const q = query(collection(db, 'edcs'), orderBy('sn', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setEdcs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any })).filter(e => e.contractStatus));
      setLoading(false);
    });
    
    const unsubscribeCust = onSnapshot(collection(db, 'customers'), (s) => {
      setCustomers(s.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubscribe();
      unsubscribeCust();
    };
  }, []);

  useEffect(() => {
    if (initialFilter && customers.length > 0) {
      const customer = customers.find(c => c.id === initialFilter);
      if (customer) {
        setSearchTerm(customer.name);
      }
    }
  }, [initialFilter, customers]);

  const exportToExcel = () => {
    const dataToExport = edcs.map(e => {
      const effectiveEnd = getAROExpectedEnd(e.expectedEndDate);
      const isARO = effectiveEnd && e.expectedEndDate && new Date(effectiveEnd) > new Date(e.expectedEndDate);
      
      let positionText = 'Di Gudang';
      if (e.status === 'Installed / Active') positionText = `Terpasang di ${e.customerName || 'Merchant'}`;
      if (e.status === 'Withdrawn') positionText = 'Ditarik (Sudah di Gudang)';
      if (e.status === 'Under Repair') positionText = 'Dalam Perbaikan';
      if (e.status === 'Lost / Missing') positionText = 'Hilang';

      return {
        'Serial Number': e.sn,
        'Vendor': e.vendor || '-',
        'Model': e.model || '-',
        'Terminal ID (TID)': e.tid || '-',
        'Merchant ID (MID)': e.mid || '-',
        'OS Version': e.osVersion || '-',
        'Condition': e.condition || '-',
        'IMEI': e.imei || '-',
        'Modem/Dongle': e.modemDongle || '-',
        'Provider': e.provider || '-',
        'SIM Type': e.simType || '-',
        'MSISDN': e.msisdn || '-',
        'ICCID': e.iccid || '-',
        'SIM Card Number': e.simCardNumber || '-',
        'Charger Included': e.chargerIncluded ? 'YES' : 'NO',
        'Battery Included': e.batteryIncluded ? 'YES' : 'NO',
        'Other Peripherals': e.otherPeripherals || '-',
        'Posisi EDC': positionText,
        'Pelanggan': e.customerName || '-',
        'Location': e.locationName || 'Kantor Pusat',
        'Contract Scheme': e.contractScheme || '-',
        'Monthly Rental': e.currentMonthlyRental || 0,
        'Contract Start Date': e.contractStartDate ? format(new Date(e.contractStartDate), 'yyyy-MM-dd') : '-',
        'Original Expected End Date': e.expectedEndDate ? format(new Date(e.expectedEndDate), 'yyyy-MM-dd') : '-',
        'Effective Expected End Date (ARO)': effectiveEnd ? format(effectiveEnd, 'yyyy-MM-dd') : '-',
        'Is In ARO Period?': isARO ? 'YES (Auto-Renewed)' : 'NO',
        'Actual End Date': e.contractEndDateActual ? format(new Date(e.contractEndDateActual), 'yyyy-MM-dd') : '-',
        'Contract Status': e.contractStatus || '-',
        'Remaining Months at Termination': e.remainingMonthsAtTermination || '-',
        'Early Termination Penalty': e.penaltyAmount || 0,
        'Part Penalty': e.partPenaltyAmount || 0,
        'Total Penalty': (e.penaltyAmount || 0) + (e.partPenaltyAmount || 0),
        'Damaged Parts List': (e.damagedParts || []).join(', '),
        'System Log Timestamp': e.updatedAt ? format(e.updatedAt.toDate(), 'yyyy-MM-dd HH:mm:ss') : '-'
      };
    });
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Detailed_EDC_Lifecycle_Log');
    XLSX.writeFile(wb, 'Report_Monitoring_Kontrak_Lengkap.xlsx');
  };

  const filteredEdcs = edcs.filter(e => 
    e.sn.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.customerName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.model.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCancelTermination = async (edc: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!edc || !edc.id) return;
    
    if (!window.confirm(`Konfirmasi pembatalan pengakhiran kontrak untuk unit ${edc.sn}? Denda akan di-reset, status unit kembali 'Installed / Active', dan masa berlaku akan berlanjut.`)) return;
    
    setActionLoading(true);
    try {
      const edcRef = doc(db, 'edcs', edc.id);
      const updateData: any = {
        contractStatus: 'Active',
        status: 'Installed / Active',
        penaltyAmount: 0,
        partPenaltyAmount: 0,
        contractEndDateActual: deleteField(),
        remainingMonthsAtTermination: deleteField(),
        damagedParts: deleteField(),
        isTerminatedInARO: deleteField(),
        updatedAt: serverTimestamp()
      };

      if (auth.currentUser?.uid) {
        updateData.lastUpdatedBy = auth.currentUser.uid;
      }

      const batch = writeBatch(db);
      batch.update(edcRef, updateData);
      
      // Also log this as a special movement/event
      const logRef = doc(collection(db, 'movements'));
      batch.set(logRef, {
        edcId: edc.id,
        type: 'Cancel Termination',
        toStatus: 'Installed / Active',
        fromStatus: edc.status || 'Terminated',
        notes: 'PULIHKAN KONTRAK: Pembatalan pengakhiran kontrak manual.',
        timestamp: serverTimestamp(),
        userId: auth.currentUser?.uid,
        userName: auth.currentUser?.displayName || 'Admin'
      });

      await batch.commit();
      
      alert(`Sukses: Kontrak & Status unit ${edc.sn} telah dipulihkan menjadi Aktif.`);
      if (selectedEdc?.id === edc.id) {
        setShowDetail(false);
        setSelectedEdc(null);
      }
      setSelectedIds(prev => prev.filter(id => id !== edc.id));
    } catch (error: any) {
      console.error('Error in handleCancelTermination:', error);
      alert(`Gagal membatalkan pengakhiran: ${error.message || 'Error unknown'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkCancelTermination = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Konfirmasi PEMULIHAN MASSAL untuk ${selectedIds.length} unit terpilih? Seluruh denda akan dihapus dan unit kembali Aktif (Installed).`)) return;

    setActionLoading(true);
    try {
      const batch = writeBatch(db);
      
      for (const id of selectedIds) {
        const edc = edcs.find(e => e.id === id);
        const edcRef = doc(db, 'edcs', id);
        const updateData: any = {
          contractStatus: 'Active',
          status: 'Installed / Active',
          penaltyAmount: 0,
          partPenaltyAmount: 0,
          contractEndDateActual: deleteField(),
          remainingMonthsAtTermination: deleteField(),
          damagedParts: deleteField(),
          isTerminatedInARO: deleteField(),
          updatedAt: serverTimestamp()
        };

        if (auth.currentUser?.uid) {
          updateData.lastUpdatedBy = auth.currentUser.uid;
        }

        batch.update(edcRef, updateData);

        // Individual logs for each recovery
        const logRef = doc(collection(db, 'movements'));
        batch.set(logRef, {
          edcId: id,
          type: 'Cancel Termination (Bulk)',
          toStatus: 'Installed / Active',
          fromStatus: edc?.status || 'Terminated',
          notes: 'PULIHKAN KONTRAK MASSAL.',
          timestamp: serverTimestamp(),
          userId: auth.currentUser?.uid,
          userName: auth.currentUser?.displayName || 'Admin'
        });
      }

      await batch.commit();
      
      alert(`Sukses: Berhasil memulihkan status untuk ${selectedIds.length} unit secara massal.`);
      setSelectedIds([]);
    } catch (error: any) {
      console.error('Error in handleBulkCancelTermination:', error);
      alert(`Gagal pembatalan massal: ${error.message || 'Error unknown'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const terminatableIds = filteredEdcs
      .filter(e => e.contractStatus?.includes('Terminated'))
      .map(e => e.id);
    
    if (selectedIds.length === terminatableIds.length && terminatableIds.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(terminatableIds);
    }
  };

  const getDayDiff = (endDate: string) => {
    try {
      return differenceInDays(new Date(endDate), new Date());
    } catch {
      return 0;
    }
  };

  const getStatusBadge = (status: string, expectedEnd: string) => {
    if (status?.includes('Terminated')) return { label: status, color: 'bg-red-50 text-red-700 border-red-200' };
    
    const days = getDayDiff(expectedEnd);
    if (days < 0) return { label: 'Expired', color: 'bg-gray-100 text-gray-700 border-gray-300' };
    if (days <= 30) return { label: 'Ending Soon', color: 'bg-orange-50 text-orange-700 border-orange-200' };
    return { label: 'Active', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  };

  return (
    <div className="space-y-6">
       <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-text-main tracking-tight flex items-center gap-3 uppercase">
              <ShieldAlert className="text-brand-primary" />
              Monitoring Kontrak EDC
            </h1>
            <p className="text-xs text-brand-text-muted font-bold uppercase tracking-widest mt-1">Siklus Hidup Per-Unit & Kalkulasi Denda</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button 
              onClick={exportToExcel}
              className="px-4 py-2 bg-white border border-brand-border text-brand-text-main rounded-lg text-sm font-bold hover:bg-gray-50 transition-all flex items-center gap-2 shadow-sm"
            >
              <Download size={16} />
              Export Monitor
            </button>
          </div>
        </header>

        {initialFilter && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold text-brand-primary bg-brand-primary-light px-2 py-0.5 rounded-full border border-brand-primary/20 flex items-center gap-1">
              <Filter size={10} />
              Filtering by Selected Customer
            </span>
          </div>
        )}

        {/* Filter Bar */}
        <div className="bg-white p-4 rounded-xl border border-brand-border shadow-sm flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-1 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted group-focus-within:text-brand-primary transition-colors" size={18} />
            <input 
              type="text"
              placeholder="Cari berdasarkan SN, Model, atau Pelanggan..."
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary transition-all font-medium"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Bulk Actions Bar */}
        <AnimatePresence>
          {selectedIds.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="bg-brand-primary text-white p-4 rounded-xl flex items-center justify-between shadow-lg shadow-blue-100"
            >
              <div className="flex items-center gap-4">
                <div className="bg-white/20 p-2 rounded-lg">
                  <RotateCcw size={20} />
                </div>
                <div>
                  <p className="text-sm font-bold">{selectedIds.length} Unit Terpilih</p>
                  <p className="text-[10px] font-medium opacity-80 uppercase tracking-widest">Bulk Cancel Termination Action</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setSelectedIds([])}
                  className="px-4 py-2 text-xs font-bold hover:bg-white/10 rounded-lg transition-colors"
                >
                  Batal
                </button>
                <button 
                  onClick={handleBulkCancelTermination}
                  disabled={actionLoading}
                  className="px-6 py-2 bg-white text-brand-primary rounded-lg text-xs font-black uppercase tracking-widest hover:bg-white/90 transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
                >
                  <RotateCcw size={14} className={actionLoading ? 'animate-spin' : ''} />
                  {actionLoading ? 'Processing...' : 'Execute Bulk Cancel'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="bg-white rounded-xl border border-brand-border shadow-sm overflow-hidden flex flex-col min-h-[400px]">
          <div className="px-5 py-4 border-b border-brand-border bg-[#F8FAFC]/50 flex items-center justify-between">
            <div className="font-bold text-[10px] text-brand-text-muted uppercase tracking-[0.2em] flex items-center gap-2">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Live Status Kontrak Unit
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">
                    <div className="flex items-center justify-center">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-brand-border text-brand-primary focus:ring-brand-primary"
                        checked={selectedIds.length > 0 && selectedIds.length === filteredEdcs.filter(e => e.contractStatus?.includes('Terminated')).length}
                        onChange={toggleSelectAll}
                      />
                    </div>
                  </th>
                  <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Serial Number</th>
                  <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Model / Hardware</th>
                  <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Pelanggan</th>
                  <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Posisi Unit</th>
                  <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Masa Berlaku</th>
                  <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border text-center">Rincian & Total Denda</th>
                  <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {filteredEdcs.map((edc) => {
                  const effectiveEnd = getAROExpectedEnd(edc.expectedEndDate);
                  const isARO = effectiveEnd && edc.expectedEndDate && new Date(effectiveEnd) > new Date(edc.expectedEndDate);
                  const status = getStatusBadge(edc.contractStatus, effectiveEnd?.toISOString() || edc.expectedEndDate);
                  const dayDiff = effectiveEnd ? getDayDiff(effectiveEnd.toISOString()) : getDayDiff(edc.expectedEndDate);
                  
                  // Position Logic
                  let posLabel = 'Di Gudang';
                  let posColor = 'bg-gray-100 text-gray-700 border-gray-200';
                  
                  if (edc.status === 'Installed / Active') {
                    posLabel = 'Terpasang';
                    posColor = 'bg-blue-50 text-blue-700 border-blue-200';
                  } else if (edc.status === 'Withdrawn') {
                    posLabel = 'Ditarik (Gudang)';
                    posColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                  } else if (edc.status === 'Under Repair') {
                    posLabel = 'Perbaikan';
                    posColor = 'bg-amber-50 text-amber-700 border-amber-200';
                  } else if (edc.status === 'Lost / Missing') {
                    posLabel = 'Hilang';
                    posColor = 'bg-red-50 text-red-700 border-red-200';
                  }

                  return (
                    <tr key={edc.id} className={cn(
                      "hover:bg-gray-50/80 transition-colors text-[13px]",
                      selectedIds.includes(edc.id) && "bg-brand-primary-light"
                    )}>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center">
                          {edc.contractStatus?.includes('Terminated') ? (
                            <input 
                              type="checkbox" 
                              className="w-4 h-4 rounded border-brand-border text-brand-primary focus:ring-brand-primary"
                              checked={selectedIds.includes(edc.id)}
                              onChange={(e) => toggleSelect(edc.id, e as any)}
                            />
                          ) : (
                            <div className="w-4 h-4 rounded bg-gray-100 border border-gray-200" title="Only terminated contracts can be multi-selected" />
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-bold text-brand-text-main">{edc.sn}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-brand-text-main leading-tight">{edc.vendor} • {edc.model}</span>
                          <span className="text-[10px] text-brand-text-muted font-bold tracking-tighter">TID: {edc.tid || '-'} | MID: {edc.mid || '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col text-left">
                          <span className="font-bold text-brand-text-main">{edc.customerName || 'N/A'}</span>
                          <span className="text-[9px] font-bold text-brand-primary uppercase tracking-widest">{edc.contractScheme || 'Sewa'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter w-fit border shadow-sm",
                            posColor
                          )}>
                            {posLabel}
                          </span>
                          {edc.status === 'Installed / Active' && (
                            <span className="text-[8px] text-brand-text-muted font-bold tracking-tighter truncate max-w-[120px]">
                              Loc: {edc.locationName || 'Main Store'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col font-medium text-brand-text-muted text-left">
                          <span className="text-[10px] uppercase font-bold text-brand-text-muted/60 tracking-wider">Mulai: {edc.contractStartDate ? format(new Date(edc.contractStartDate), 'yyyy-MM-dd') : '-'}</span>
                          <span className="text-brand-text-main font-bold flex items-center gap-1.5 whitespace-nowrap">
                             Akhir: {effectiveEnd ? format(effectiveEnd, 'yyyy-MM-dd') : '-'}
                             {isARO && edc.contractStatus === 'Active' && (
                               <span className="flex items-center gap-0.5 text-[8px] bg-indigo-50 text-indigo-600 px-1 py-0.5 rounded border border-indigo-200 uppercase tracking-tighter shadow-sm font-black">
                                 <RefreshCw size={8} /> ARO
                               </span>
                             )}
                          </span>
                          {isARO && edc.contractStatus === 'Active' && (
                             <span className="text-[8px] text-brand-text-muted/60 font-bold uppercase tracking-tighter">Orig: {format(new Date(edc.expectedEndDate), 'yyyy-MM-dd')}</span>
                          )}
                          {edc.contractStatus === 'Active' && (
                             <span className={`text-[9px] font-bold uppercase tracking-wider mt-1 ${dayDiff <= 30 ? 'text-red-500 animate-pulse' : 'text-brand-text-muted opacity-60'}`}>
                              {dayDiff > 0 ? `${dayDiff} hari lagi` : 'Selesai'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {(edc.penaltyAmount > 0 || edc.partPenaltyAmount > 0) ? (
                          <div className="flex flex-col gap-2">
                             <div className="grid grid-cols-2 gap-x-4 border-b border-brand-border pb-1 mb-1">
                                {edc.penaltyAmount > 0 && (
                                  <div>
                                    <span className="text-[8px] font-bold text-red-500/60 uppercase block leading-none mb-0.5">Pinalti Early</span>
                                    <span className="text-red-700 font-bold text-[10px]">Rp {Number(edc.penaltyAmount).toLocaleString()}</span>
                                  </div>
                                )}
                                {edc.partPenaltyAmount > 0 && (
                                  <div className="text-right">
                                    <span className="text-[8px] font-bold text-orange-500/60 uppercase block leading-none mb-0.5">Denda Part</span>
                                    <span className="text-orange-700 font-bold text-[10px]">Rp {Number(edc.partPenaltyAmount).toLocaleString()}</span>
                                  </div>
                                )}
                             </div>
                             <div className="flex justify-between items-center bg-gray-50 px-2 py-1 rounded">
                                <span className="text-[9px] font-black text-brand-text-muted uppercase">Total Denda</span>
                                <span className="text-xs font-black text-brand-text-main line-through decoration-red-500/0">Rp {Number((edc.penaltyAmount || 0) + (edc.partPenaltyAmount || 0)).toLocaleString()}</span>
                             </div>
                          </div>
                        ) : (
                          <div className="text-center text-xs text-brand-text-muted">-</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedEdc(edc); setShowDetail(true); }} 
                            className="p-1.5 hover:bg-white hover:text-brand-primary rounded-lg border border-transparent hover:border-brand-border transition-all text-brand-text-muted" 
                            title="View Detail"
                          >
                            <Eye size={14} />
                          </button>
                          {edc.contractStatus?.includes('Terminated') && (
                            <button 
                              type="button"
                              disabled={actionLoading}
                              onClick={(e) => handleCancelTermination(edc, e)}
                              className="p-1.5 hover:bg-brand-primary hover:text-white rounded-lg border border-transparent hover:border-brand-primary transition-all text-red-500 bg-red-50 disabled:opacity-50"
                              title="Batalkan Pengakhiran"
                            >
                              <RotateCcw size={14} className={actionLoading ? 'animate-spin' : ''} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredEdcs.length === 0 && !loading && (
             <div className="flex-1 flex flex-col items-center justify-center p-20 text-center bg-gray-50/50">
               <div className="text-brand-text-muted opacity-20 mb-3 animate-bounce"><AlertTriangle size={48} /></div>
               <p className="text-brand-text-muted text-xs font-bold uppercase tracking-[0.2em]">Data monitoring kontrak unit tidak ditemukan.</p>
             </div>
          )}
        </div>

        {/* Detail Modal */}
        <AnimatePresence>
          {showDetail && selectedEdc && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDetail(false)} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-2xl overflow-hidden border border-brand-border shadow-2xl">
                <div className="p-8 pb-4 flex justify-between items-start border-b border-brand-border bg-gray-50/50">
                  <div className="flex gap-4 items-center">
                    <div className="w-12 h-12 bg-brand-primary rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-100"><ShieldAlert size={24} /></div>
                    <div>
                      <h2 className="text-xl font-bold text-brand-text-main leading-tight">{selectedEdc.sn}</h2>
                      <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.2em]">Lifecycle Tracking: {selectedEdc.model}</p>
                    </div>
                  </div>
                  <button onClick={() => setShowDetail(false)} className="p-2 bg-white text-brand-text-muted hover:text-red-500 rounded-lg border border-brand-border"><X size={20} /></button>
                </div>
                <div className="p-8 space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                     <div className="p-4 bg-gray-50 rounded-2xl border border-brand-border col-span-2">
                      <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-1.5 opacity-60">Pelanggan</p>
                      <p className="text-base font-black text-brand-text-main">{selectedEdc.customerName || '-'}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl border border-brand-border">
                      <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-1">Mulai Kontrak</p>
                      <p className="text-sm font-bold text-brand-text-main">{selectedEdc.contractStartDate ? format(new Date(selectedEdc.contractStartDate), 'PPP') : '-'}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl border border-brand-border">
                      <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-1">Ekspektasi Berakhir</p>
                      <div className="flex flex-col">
                        <p className="text-sm font-bold text-brand-text-main">
                          {selectedEdc.expectedEndDate ? format(getAROExpectedEnd(selectedEdc.expectedEndDate) || new Date(selectedEdc.expectedEndDate), 'PPP') : '-'}
                        </p>
                        {(getAROExpectedEnd(selectedEdc.expectedEndDate)?.getTime() || 0) > new Date(selectedEdc.expectedEndDate).getTime() && (
                          <span className="text-[8px] text-indigo-600 font-black uppercase tracking-tighter flex items-center gap-1 mt-0.5">
                            <RefreshCw size={8} className="animate-spin-slow" /> Auto-Renewed (ARO)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl border border-brand-border">
                      <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-1">Skema Kontrak</p>
                      <p className="text-sm font-bold text-brand-primary uppercase">{selectedEdc.contractScheme || 'Sewa'}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl border border-brand-border">
                      <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-1">Status Kontrak</p>
                      <p className="text-sm font-bold text-brand-text-main uppercase">{selectedEdc.contractStatus}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl border border-brand-border">
                      <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-1">Denda Part</p>
                      <p className="text-sm font-bold text-orange-600">Rp {Number(selectedEdc.partPenaltyAmount || 0).toLocaleString()}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl border border-brand-border">
                      <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-1">Harga Sewa / Bulan</p>
                      <p className="text-sm font-bold text-brand-text-main">Rp {Number(selectedEdc.currentMonthlyRental || 0).toLocaleString()}</p>
                    </div>
                  </div>

                  {selectedEdc.damagedParts && selectedEdc.damagedParts.length > 0 && (
                    <div className="bg-gray-50 border border-brand-border rounded-xl p-4">
                       <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-2">Part Hilang / Rusak</p>
                       <div className="flex flex-wrap gap-2">
                         {selectedEdc.damagedParts.map((part: string, idx: number) => (
                           <span key={idx} className="px-2 py-1 bg-white border border-brand-border rounded text-[10px] font-bold text-brand-text-main">
                             {part}
                           </span>
                         ))}
                       </div>
                    </div>
                  )}

                  {((selectedEdc.penaltyAmount || 0) + (selectedEdc.partPenaltyAmount || 0)) > 0 && (
                    <div className="p-5 bg-red-50 border border-red-200 rounded-2xl space-y-3">
                       <div className="flex items-center gap-3 border-b border-red-100 pb-3 mb-1">
                          <div className="w-8 h-8 bg-red-100 text-red-600 rounded-full flex items-center justify-center shrink-0">
                            <AlertTriangle size={16} />
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-red-600 uppercase tracking-widest">Rincian Kewajiban Pembayaran</p>
                          </div>
                       </div>
                       
                       <div className="space-y-2 text-xs">
                         <div className="flex justify-between items-center">
                            <span className="font-bold text-red-800/70 uppercase text-[9px]">Denda Pengakhiran (Early)</span>
                            <span className="font-black text-red-700">Rp {Number(selectedEdc.penaltyAmount || 0).toLocaleString()}</span>
                         </div>
                         <div className="flex justify-between items-center">
                            <span className="font-bold text-orange-800/70 uppercase text-[9px]">Denda Part (Hilang/Rusak)</span>
                            <span className="font-black text-orange-700">Rp {Number(selectedEdc.partPenaltyAmount || 0).toLocaleString()}</span>
                         </div>
                         <div className="pt-2 border-t border-red-200 flex justify-between items-center">
                            <span className="font-black text-red-900 uppercase text-[10px]">Total Kewajiban</span>
                            <span className="font-black text-red-900 text-base">Rp {Number((selectedEdc.penaltyAmount || 0) + (selectedEdc.partPenaltyAmount || 0)).toLocaleString()}</span>
                         </div>
                       </div>
                       
                       {selectedEdc.penaltyAmount > 0 && (
                         <p className="text-[9px] font-bold text-red-700/60 bg-red-100/50 p-2 rounded leading-tight italic text-center">
                           *Pinalti early termination dihitung dari {selectedEdc.remainingMonthsAtTermination || '?'} bulan sisa kontrak dikali biaya sewa per unit.
                         </p>
                       )}
                    </div>
                  )}

                  {selectedEdc.contractStatus?.includes('Terminated') && (
                    <button 
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleCancelTermination(selectedEdc)}
                      className="w-full py-3 bg-red-50 text-red-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-red-100 transition-colors border border-red-100 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <RotateCcw size={16} className={actionLoading ? 'animate-spin' : ''} />
                      {actionLoading ? 'Processing...' : 'Batalkan Pengakhiran Kontrak'}
                    </button>
                  )}

                  <button onClick={() => setShowDetail(false)} className="w-full py-4 bg-brand-text-main text-white text-xs font-black uppercase tracking-widest rounded-xl hover:opacity-90 transition-opacity mt-4 shadow-lg shadow-gray-200">Tutup Monitoring</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
    </div>
  );
}
