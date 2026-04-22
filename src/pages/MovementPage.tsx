import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, serverTimestamp, doc, updateDoc, getDocs, limit } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { cn } from '../lib/utils';
import { ArrowRight, History, Package, MapPin, User, FileCheck, ClipboardList, ArrowLeftRight, CheckCircle, MessageSquare, AlertCircle, X, ShieldAlert, Plus, Trash2, Search } from 'lucide-react';
import { format, addMonths, differenceInMonths, differenceInDays } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { getAROExpectedEnd } from '../lib/utils';
import { generateBAPDF } from '../lib/baGenerator';
import { jsPDF } from 'jspdf';

export function MovementPage({ preSelectedIds = [] }: { preSelectedIds?: string[] }) {
  const [movements, setMovements] = useState<any[]>([]);
  const [edcs, setEdcs] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [edcParts, setEdcParts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Withdrawal States
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [selectedParts, setSelectedParts] = useState<string[]>([]);
  const [pendingPenaltyData, setPendingPenaltyData] = useState<{ penalty: number, items: string[] } | null>(null);

  // BA States
  const [showBAPreview, setShowBAPreview] = useState(false);
  const [baFormFields, setBaFormFields] = useState({
    picName: '',
    technicianName: ''
  });

  useEffect(() => {
    if (auth.currentUser?.displayName) {
      setBaFormFields(prev => ({ ...prev, technicianName: auth.currentUser?.displayName || '' }));
    }
  }, [auth.currentUser]);

  // Form State
  const [formData, setFormData] = useState({
    edcIds: preSelectedIds,
    type: 'Allocation',
    toStatus: 'Reserved / Allocated',
    customerId: '',
    notes: '',
    transactionDate: format(new Date(), 'yyyy-MM-dd')
  });

  useEffect(() => {
    if (preSelectedIds.length > 0) {
      setFormData(prev => ({ ...prev, edcIds: preSelectedIds }));
    }
  }, [preSelectedIds]);

  const [edcSearchTerm, setEdcSearchTerm] = useState('');

  const handleBulkAdd = (text: string) => {
    // Split by space, comma, tab, or newline
    const sns = text.split(/[\s,]+/).filter(s => s.trim().length > 0);
    if (sns.length > 1 || (sns.length === 1 && !edcs.find(e => e.sn === sns[0]))) {
      const foundIds: string[] = [];
      const notFound: string[] = [];

      sns.forEach(sn => {
        const match = edcs.find(e => e.sn.toLowerCase() === sn.toLowerCase());
        if (match) {
          if (!formData.edcIds.includes(match.id)) {
            foundIds.push(match.id);
          }
        } else {
          notFound.push(sn);
        }
      });

      if (foundIds.length > 0) {
        setFormData(prev => ({ ...prev, edcIds: [...prev.edcIds, ...foundIds] }));
        setEdcSearchTerm('');
        
        if (notFound.length > 0) {
          alert(`Berhasil menambahkan ${foundIds.length} unit. ${notFound.length} SN tidak ditemukan: ${notFound.join(', ')}`);
        }
      } else if (notFound.length > 0 && sns.length > 1) {
        alert(`Tidak ada SN yang cocok ditemukan dari daftar.`);
      }
    }
  };

  useEffect(() => {
    onSnapshot(query(collection(db, 'movements'), orderBy('timestamp', 'desc'), limit(15)), (s) => {
      setMovements(s.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    onSnapshot(collection(db, 'edcs'), (s) => setEdcs(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    onSnapshot(collection(db, 'customers'), (s) => setCustomers(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    onSnapshot(collection(db, 'edc_parts'), (s) => setEdcParts(s.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  const handleProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.edcIds.length === 0) return;

    if (formData.type === 'Withdrawal') {
      setShowWithdrawalModal(true);
      return;
    }

    prepareBA();
  };

  const prepareBA = () => {
    const selectedCust = customers.find(c => c.id === formData.customerId);
    setBaFormFields(prev => ({ 
      ...prev, 
      picName: selectedCust?.picName || ''
    }));
    setShowBAPreview(true);
  };

  const executeMovement = async () => {
    setLoading(true);
    try {
      const selectedCust = customers.find(c => c.id === formData.customerId);
      const effectiveTransactionDate = new Date(formData.transactionDate);
      const generatedAt = new Date().toISOString();

      // Prepared BA Data for the batch
      const baBatchData = {
        templateType: formData.type,
        generatedAt: generatedAt,
        customerPIC: baFormFields.picName,
        technician: baFormFields.technicianName
      };

      for (const edcId of formData.edcIds) {
        const selectedEdc = edcs.find(e => e.id === edcId);
        if (!selectedEdc) continue;

        let contractUpdates: any = {};
        
        // LOGIC: Contract Lifecycle
        if (formData.type === 'Install') {
          const duration = selectedCust?.contractDuration || 12;
          const startDate = effectiveTransactionDate;
          const expectedEndDate = addMonths(startDate, duration);
          
          contractUpdates = {
            contractStartDate: startDate.toISOString(),
            expectedEndDate: expectedEndDate.toISOString(),
            contractStatus: 'Active',
            contractScheme: selectedCust?.scheme || 'Sewa',
            penaltyAmount: 0,
            partPenaltyAmount: 0,
            currentMonthlyRental: selectedCust?.value || 0
          };
        } else if (formData.type === 'Withdrawal') {
          if (selectedEdc?.contractStatus === 'Active' && selectedEdc?.expectedEndDate) {
            // ARO Logic: Calculate the actual current end date
            const effectiveEnd = getAROExpectedEnd(selectedEdc.expectedEndDate) || new Date(selectedEdc.expectedEndDate);
            const now = effectiveTransactionDate;
            
            if (now < effectiveEnd) {
              // Early Termination Penalty (applied even in ARO period)
              const remainingMonths = Math.max(1, differenceInMonths(effectiveEnd, now) + (differenceInDays(effectiveEnd, now) % 30 > 0 ? 1 : 0));
              const monthlyRental = selectedEdc.currentMonthlyRental || selectedCust?.value || 0;
              const penalty = remainingMonths * monthlyRental;
              
              contractUpdates = {
                contractStatus: 'Terminated (Early)',
                contractEndDateActual: now.toISOString(),
                penaltyAmount: penalty,
                remainingMonthsAtTermination: remainingMonths,
                isTerminatedInARO: (effectiveEnd.getTime() > new Date(selectedEdc.expectedEndDate).getTime())
              };
            } else {
              contractUpdates = {
                contractStatus: 'Terminated (Normal)',
                contractEndDateActual: now.toISOString(),
                penaltyAmount: 0
              };
            }
          }
          
          // Add Parts Penalty if provided
          if (pendingPenaltyData) {
            contractUpdates.partPenaltyAmount = (selectedEdc?.partPenaltyAmount || 0) + pendingPenaltyData.penalty;
            contractUpdates.damagedParts = pendingPenaltyData.items;
          }
        }

        // Update EDC status
        const edcRef = doc(db, 'edcs', edcId);
        await updateDoc(edcRef, {
          status: formData.toStatus,
          currentCustomerId: formData.customerId,
          customerName: selectedCust?.name || null,
          hasBA: true,
          ...contractUpdates,
          updatedAt: serverTimestamp(),
          lastUpdatedBy: auth.currentUser?.uid
        });

        // Log movement
        await addDoc(collection(db, 'movements'), {
          edcId: edcId,
          type: formData.type,
          toStatus: formData.toStatus,
          customerId: formData.customerId,
          notes: pendingPenaltyData ? `${formData.notes} | Parts Missing: ${pendingPenaltyData.items.join(', ')}` : formData.notes,
          fromStatus: selectedEdc.status,
          transactionDate: formData.transactionDate,
          baGenerated: true,
          baData: baBatchData,
          timestamp: serverTimestamp(),
          userId: auth.currentUser?.uid,
          userName: auth.currentUser?.displayName
        });
      }

      // Generate and Download PDF
      const baPdfData = {
        movementType: formData.type,
        transactionDate: formData.transactionDate,
        customerName: selectedCust?.name || 'Warehouse / General',
        customerAddress: selectedCust?.address || '-',
        customerPIC: baFormFields.picName,
        devices: formData.edcIds.map(id => {
          const e = edcs.find(x => x.id === id);
          return {
            sn: e?.sn || id,
            model: e?.model || '-',
            tid: e?.tid,
            mid: e?.mid,
            status: formData.toStatus
          };
        }),
        notes: formData.notes,
        technicianName: baFormFields.technicianName,
        generatedAt: generatedAt
      };
      
      const docPdf = generateBAPDF(baPdfData);
      docPdf.save(`BA_${formData.type}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);

      setFormData({ 
        edcIds: [], 
        type: 'Allocation', 
        toStatus: 'In Delivery', 
        customerId: '', 
        notes: '',
        transactionDate: format(new Date(), 'yyyy-MM-dd')
      });
      setSelectedParts([]);
      setPendingPenaltyData(null);
      setShowWithdrawalModal(false);
      setShowBAPreview(false);
      alert(`Movement processed & BA Generated successfully for ${formData.edcIds.length} assets!`);
    } catch (error) {
      console.error(error);
      alert("Error processing movement");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmWithdrawal = () => {
    const selectedPartDetails = edcParts.filter(p => selectedParts.includes(p.id));
    const totalPenalty = selectedPartDetails.reduce((sum, p) => sum + (p.price || 0), 0);
    const partNames = selectedPartDetails.map(p => p.name);
    
    setPendingPenaltyData({ penalty: totalPenalty, items: partNames });
    setShowWithdrawalModal(false);
    prepareBA();
  };

  const downloadBA = (move: any) => {
    const selectedCust = customers.find(c => c.id === move.customerId);
    const edcDetails = edcs.find(e => e.id === move.edcId);
    
    const baPdfData = {
      movementType: move.type,
      transactionDate: move.transactionDate || (move.timestamp ? format(move.timestamp.toDate(), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')),
      customerName: selectedCust?.name || move.customerName || 'General',
      customerAddress: selectedCust?.address || '-',
      customerPIC: move.baData?.customerPIC || '-',
      devices: [{
        sn: edcDetails?.sn || move.edcId,
        model: edcDetails?.model || '-',
        tid: edcDetails?.tid,
        mid: edcDetails?.mid,
        status: move.toStatus
      }],
      notes: move.notes,
      technicianName: move.baData?.technician || move.userName || 'Admin',
      generatedAt: move.baData?.generatedAt || move.timestamp?.toDate()?.toISOString() || new Date().toISOString()
    };
    
    const docPdf = generateBAPDF(baPdfData);
    docPdf.save(`BA_${move.type}_${edcDetails?.sn || move.edcId}.pdf`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1 space-y-6">
        <header className="mb-2">
          <h1 className="text-2xl font-bold text-brand-text-main tracking-tight uppercase flex items-center gap-3">
            <ArrowLeftRight className="text-brand-primary" />
            Pergerakan EDC
          </h1>
          <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-widest mt-1">Logistik & Lifecycle Transaction</p>
        </header>

        <form onSubmit={handleProcess} className="bg-white p-6 rounded-xl border border-brand-border shadow-sm space-y-5">
           <div className="font-bold text-xs text-brand-text-muted uppercase tracking-widest border-b border-brand-border pb-3 mb-4">New Lifecycle Transaction</div>
          
          <div className="space-y-4">
            <div className="space-y-3">
              <label className="text-[11px] font-bold text-brand-text-muted uppercase tracking-wider px-1">Selected Assets ({formData.edcIds.length})</label>
              
              <div className="relative">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-400">
                  <Search size={14} />
                </div>
                <input 
                  type="text"
                  placeholder="Paste multiple SN or search..."
                  className="w-full pl-9 pr-3 py-2.5 bg-gray-50 rounded-lg border border-brand-border text-sm focus:ring-1 focus:ring-brand-primary outline-none"
                  value={edcSearchTerm}
                  onChange={e => setEdcSearchTerm(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleBulkAdd(edcSearchTerm);
                    }
                  }}
                  onPaste={e => {
                    const text = e.clipboardData.getData('text');
                    if (/[\s,]+/.test(text.trim())) {
                      e.preventDefault();
                      handleBulkAdd(text);
                    }
                  }}
                />
                
                {edcSearchTerm && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-brand-border rounded-lg shadow-xl max-h-[200px] overflow-y-auto">
                    {edcs
                      .filter(e => e.assetType === 'perangkat' && e.sn.toLowerCase().includes(edcSearchTerm.toLowerCase()) && !formData.edcIds.includes(e.id))
                      .map(e => (
                        <button
                          key={e.id}
                          type="button"
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center justify-between group border-b border-gray-50 last:border-0"
                          onClick={() => {
                            setFormData({...formData, edcIds: [...formData.edcIds, e.id]});
                            setEdcSearchTerm('');
                          }}
                        >
                          <span className="font-bold text-brand-text-main">{e.sn}</span>
                          <span className="text-[10px] font-bold text-brand-text-muted uppercase bg-gray-100 px-2 py-0.5 rounded group-hover:bg-brand-primary group-hover:text-white transition-colors">{e.status}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 max-h-[150px] overflow-y-auto p-1">
                {formData.edcIds.map(id => {
                  const edc = edcs.find(e => e.id === id);
                  return (
                    <div key={id} className="group flex items-center gap-2 px-3 py-1.5 bg-brand-primary-light text-brand-primary rounded-lg text-xs font-bold border border-brand-primary/20">
                      <span>{edc?.sn}</span>
                      <button 
                        type="button"
                        onClick={() => setFormData({...formData, edcIds: formData.edcIds.filter(i => i !== id)})}
                        className="hover:text-red-500 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
                {formData.edcIds.length === 0 && !edcSearchTerm && (
                  <p className="text-[10px] text-brand-text-muted italic w-full text-center py-2">No assets selected. Search and add above.</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-brand-text-muted uppercase tracking-wider px-1">Movement Type</label>
              <select 
                className="w-full px-3 py-2.5 bg-gray-50 rounded-lg border border-brand-border text-sm font-medium focus:ring-1 focus:ring-brand-primary outline-none"
                value={formData.type}
                onChange={e => {
                  let status = 'In Delivery';
                  if (e.target.value === 'Withdrawal') status = 'Withdrawn';
                  if (e.target.value === 'Repair') status = 'Under Repair';
                  if (e.target.value === 'Install') status = 'Installed / Active';
                  setFormData({...formData, type: e.target.value, toStatus: status});
                }}
              >
                <option>Allocation</option>
                <option>Install</option>
                <option>Withdrawal</option>
                <option>Repair</option>
                <option>Relocation</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-brand-text-muted uppercase tracking-wider px-1">Transaction Date</label>
              <input 
                type="date"
                required
                className="w-full px-3 py-2.5 bg-gray-50 rounded-lg border border-brand-border text-sm font-medium focus:ring-1 focus:ring-brand-primary outline-none"
                value={formData.transactionDate}
                onChange={e => setFormData({...formData, transactionDate: e.target.value})}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-brand-text-muted uppercase tracking-wider px-1">Target Account</label>
              <select 
                className="w-full px-3 py-2.5 bg-gray-50 rounded-lg border border-brand-border text-sm font-medium focus:ring-1 focus:ring-brand-primary outline-none"
                value={formData.customerId}
                onChange={e => setFormData({...formData, customerId: e.target.value})}
              >
                <option value="">No Customer / Warehouse</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-brand-text-muted uppercase tracking-wider px-1">Internal Notes</label>
              <textarea 
                className="w-full px-3 py-2.5 bg-gray-50 rounded-lg border border-brand-border text-sm min-h-[80px] outline-none transition-all focus:ring-1 focus:ring-brand-primary"
                placeholder="Log details..."
                value={formData.notes}
                onChange={e => setFormData({...formData, notes: e.target.value})}
              />
            </div>
          </div>

          <button 
            disabled={loading}
            className="w-full py-3 bg-brand-primary text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 hover:bg-brand-primary-dark transition-all disabled:opacity-50"
          >
            {loading ? 'Processing...' : (
              <>
                Execute Movement
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
      </div>

      <div className="lg:col-span-2 space-y-6">
        <h2 className="text-sm font-bold text-brand-text-muted uppercase tracking-widest flex items-center gap-2">
          <History size={16} className="text-brand-primary" />
          Recent Logistics Log
        </h2>
        {/* BA Preview Modal */}
        <AnimatePresence>
          {showBAPreview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowBAPreview(false)} className="absolute inset-0 bg-gray-900/40 backdrop-blur-md" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-brand-border">
                <div className="p-6 border-b border-brand-border bg-gray-50 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-black text-brand-text-main uppercase tracking-tight">Preview Berita Acara</h2>
                    <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-widest mt-0.5">Sistem CIM ArtaJasa - Auto Generated</p>
                  </div>
                  <button onClick={() => setShowBAPreview(false)} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><X size={20} /></button>
                </div>
                
                <div className="p-8 space-y-6">
                  <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3 items-start">
                    <ClipboardList className="text-blue-500 shrink-0 mt-0.5" size={18} />
                    <div className="text-xs text-blue-800 font-medium leading-relaxed">
                      <p className="font-bold text-sm mb-1 uppercase tracking-tight">Template: Berita Acara {formData.type}</p>
                      Dokumen BA akan dihasilkan secara otomatis berdasarkan data yang Anda input. Pastikan detail PIC di bawah ini benar.
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Nama PIC Merchant</label>
                      <input 
                        required
                        type="text"
                        className="w-full px-3 py-2.5 bg-gray-50 rounded-lg border border-brand-border text-sm font-bold focus:ring-1 focus:ring-brand-primary outline-none"
                        value={baFormFields.picName}
                        onChange={e => setBaFormFields({...baFormFields, picName: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Nama Teknisi / Admin</label>
                      <input 
                        required
                        type="text"
                        className="w-full px-3 py-2.5 bg-gray-50 rounded-lg border border-brand-border text-sm font-bold focus:ring-1 focus:ring-brand-primary outline-none"
                        value={baFormFields.technicianName}
                        onChange={e => setBaFormFields({...baFormFields, technicianName: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="border border-brand-border rounded-xl p-4 bg-gray-50/50">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Item dalam Berita Acara:</p>
                    <div className="space-y-2 max-h-[120px] overflow-y-auto">
                      {formData.edcIds.map(id => {
                        const e = edcs.find(x => x.id === id);
                        return (
                          <div key={id} className="flex items-center justify-between bg-white p-2 rounded border border-brand-border text-xs">
                            <span className="font-bold">{e?.sn}</span>
                            <span className="text-brand-text-muted">{e?.vendor} {e?.model}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button onClick={() => setShowBAPreview(false)} className="flex-1 py-4 text-xs font-black text-brand-text-muted uppercase tracking-widest bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">Batal</button>
                    <button 
                      onClick={() => executeMovement()} 
                      disabled={loading || !baFormFields.picName || !baFormFields.technicianName} 
                      className="flex-1 py-4 bg-brand-primary text-white text-xs font-black rounded-xl shadow-lg shadow-blue-100 uppercase tracking-widest disabled:opacity-50"
                    >
                       {loading ? 'Processing...' : 'Confirm & Execute'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Withdrawal Modal */}
        <AnimatePresence>
          {showWithdrawalModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowWithdrawalModal(false)} className="absolute inset-0 bg-gray-900/40 backdrop-blur-md" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-brand-border">
                <div className="p-6 border-b border-brand-border bg-gray-50 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-black text-brand-text-main uppercase tracking-tight">Konfirmasi Penarikan (Checklist)</h2>
                    <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-widest mt-0.5">Verifikasi Kelengkapan Aset</p>
                  </div>
                  <button onClick={() => setShowWithdrawalModal(false)} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><X size={20} /></button>
                </div>
                
                <div className="p-8">
                  <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-6 flex gap-3 items-start">
                    <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={18} />
                    <p className="text-xs text-amber-800 font-medium leading-relaxed">
                      Silakan checklist komponen yang <span className="font-bold underline italic">hilang atau rusak</span>. 
                      Sistem akan menghitung denda penggantian secara otomatis berdasarkan harga master part.
                    </p>
                  </div>

                  <div className="space-y-3 max-h-[300px] overflow-y-auto mb-6 pr-2 scrollbar-thin scrollbar-thumb-gray-200">
                    {edcParts.map(part => (
                      <label key={part.id} className={cn(
                        "flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer group",
                        selectedParts.includes(part.id) 
                          ? "bg-red-50 border-red-200 ring-1 ring-red-200 shadow-sm" 
                          : "bg-white border-brand-border hover:bg-gray-50"
                      )}>
                        <div className="flex items-center gap-3">
                          <input 
                            type="checkbox" 
                            className="w-5 h-5 rounded-lg border-brand-border text-red-600 focus:ring-red-500"
                            checked={selectedParts.includes(part.id)}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedParts([...selectedParts, part.id]);
                              else setSelectedParts(selectedParts.filter(id => id !== part.id));
                            }}
                          />
                          <div>
                            <p className="text-sm font-bold text-brand-text-main">{part.name}</p>
                            <p className="text-[10px] text-brand-text-muted font-bold uppercase">Biaya Ganti</p>
                          </div>
                        </div>
                        <span className={cn(
                          "text-sm font-black",
                          selectedParts.includes(part.id) ? "text-red-600" : "text-brand-text-muted"
                        )}>
                          Rp {Number(part.price || 0).toLocaleString()}
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="flex gap-4">
                    <button onClick={() => setShowWithdrawalModal(false)} className="flex-1 py-4 text-xs font-black text-brand-text-muted uppercase tracking-widest bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">Batal</button>
                    <button onClick={handleConfirmWithdrawal} disabled={loading} className="flex-1 py-4 bg-brand-primary text-white text-xs font-black rounded-xl shadow-lg shadow-blue-100 uppercase tracking-widest">
                       {loading ? 'Processing...' : 'Selesaikan Penarikan'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <div className="space-y-3">
          {movements.map((move) => (
            <div key={move.id} className="bg-white p-4 rounded-xl border border-brand-border shadow-sm flex items-start gap-4 hover:shadow-md transition-all">
              <div className="shrink-0 w-8 h-8 bg-brand-primary-light rounded-lg flex items-center justify-center text-brand-primary">
                <ClipboardList size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-bold text-brand-text-main text-sm truncate uppercase tracking-tight">
                    {edcs.find(e => e.id === move.edcId)?.sn || 'Asset ID: ' + move.edcId}
                  </h4>
                  <div className="flex items-center gap-3">
                    {move.baGenerated && (
                      <button 
                        onClick={() => downloadBA(move)}
                        className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded text-[9px] font-black uppercase hover:bg-emerald-100 transition-colors"
                      >
                        <FileCheck size={10} />
                        BA Ready
                      </button>
                    )}
                    <span className="text-[10px] text-brand-text-muted font-bold tracking-widest">{move.timestamp ? format(move.timestamp.toDate(), 'HH:mm • MMM d') : 'PENDING'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-2">
                   <div className="text-[10px] font-bold text-brand-text-muted uppercase bg-gray-50 px-2 py-0.5 rounded border border-brand-border inline-flex items-center gap-1.5">
                    {move.type}
                  </div>
                  <ArrowRight size={10} className="text-gray-300" />
                  <span className="text-[10px] bg-brand-primary text-white px-2 py-0.5 rounded font-bold">{move.toStatus}</span>
                  {move.transactionDate && (
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 flex items-center gap-1">
                      Eff: {format(new Date(move.transactionDate), 'MMM d, yyyy')}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-brand-text-muted font-medium italic opacity-80 leading-relaxed mb-3">"{move.notes || 'Routine status update'}"</p>
                <div className="flex items-center gap-2 text-[10px] font-bold text-brand-primary uppercase tracking-[0.1em]">
                  <User size={10} />
                  Initiated by: {move.userName}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
