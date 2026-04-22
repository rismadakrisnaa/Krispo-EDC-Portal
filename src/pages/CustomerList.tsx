import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, addDoc, serverTimestamp, doc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Plus, Users, Mail, Phone, MapPin, Search, FileUp, Download, X, Edit2, Trash2, Eye, Filter, RefreshCw, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';

export function CustomerList({ onViewAssets, onViewContract }: { 
  onViewAssets: (id: string) => void;
  onViewContract: (customerId: string) => void;
}) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const [newCust, setNewCust] = useState({ 
    name: '', 
    email: '', 
    category: 'Retail', 
    picName: '', 
    contact: '', 
    address: '',
    scheme: 'Sewa',
    value: 0,
    contractDuration: 12
  });
  const [editingCust, setEditingCust] = useState<any>(null);
  const [selectedCust, setSelectedCust] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string, name: string } | { count: number, ids: string[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'customers'), {
        ...newCust,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setShowAdd(false);
      setNewCust({ 
        name: '', 
        email: '', 
        category: 'Retail', 
        picName: '', 
        contact: '', 
        address: '',
        scheme: 'Sewa',
        value: 0,
        contractDuration: 12
      });
    } catch (error) {
      console.error(error);
      alert('Gagal menambah customer.');
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCust) return;
    try {
      const { id, ...data } = editingCust;
      await updateDoc(doc(db, 'customers', id), {
        ...data,
        updatedAt: serverTimestamp()
      });
      setShowEdit(false);
    } catch (error) {
      console.error(error);
      alert('Gagal update data.');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if ('ids' in deleteTarget) {
        const batch = writeBatch(db);
        deleteTarget.ids.forEach(id => batch.delete(doc(db, 'customers', id)));
        await batch.commit();
        setSelectedIds([]);
      } else {
        await deleteDoc(doc(db, 'customers', deleteTarget.id));
      }
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    } catch (error) {
      console.error(error);
      alert('Gagal menghapus data.');
    } finally {
      setDeleting(false);
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const batchSize = 500;
        for (let i = 0; i < data.length; i += batchSize) {
          const batch = writeBatch(db);
          const chunk = data.slice(i, i + batchSize);
          chunk.forEach((row) => {
            const docRef = doc(collection(db, 'customers'));
            batch.set(docRef, {
              name: row['Customer Name'] || '',
              email: row['Email'] || '',
              category: row['Category'] || 'Retail',
              picName: row['PIC Name'] || '',
              contact: row['Contact Number'] || '',
              address: row['Address'] || '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          });
          await batch.commit();
        }
        setShowImport(false);
        alert(`Berhasil mengimpor ${data.length} customer.`);
      } catch (error) {
        console.error(error);
        alert('Gagal mengimpor data. Pastikan format Excel benar.');
      } finally {
        setImportLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        'Customer Name': 'Artajasa Pembayaran Elektronis',
        'Email': 'info@artajasa.co.id',
        'Category': 'Enterprise',
        'PIC Name': 'Budi Santoso',
        'Contact Number': '08123456789',
        'Address': 'BSD City, Tangerang',
        'Scheme': 'Sewa',
        'Value': 500000000,
        'Duration': 24
      }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Customer_Import_Template.xlsx');
  };

  const exportToExcel = () => {
    const dataToExport = customers.map(c => ({
      'Customer Name': c.name,
      'Email': c.email,
      'Category': c.category,
      'PIC Name': c.picName,
      'Contact Number': c.contact,
      'Address': c.address,
      'Scheme': c.scheme || '-',
      'Value': c.value || 0,
      'Duration': c.contractDuration || 0
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    XLSX.writeFile(wb, 'B2B_Customers_Report.xlsx');
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.picName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-text-main tracking-tight flex items-center gap-3">
            <Users className="text-brand-primary" />
            Master B2B Customers
          </h1>
          <p className="text-xs text-brand-text-muted font-bold uppercase tracking-widest mt-1">Manajemen Pelanggan & Mitra Strategis</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button 
            onClick={() => setShowImport(true)}
            className="px-4 py-2 bg-white border border-brand-border text-brand-text-main rounded-lg text-sm font-bold hover:bg-gray-50 transition-all flex items-center gap-2"
          >
            <FileUp size={16} />
            Bulk Import
          </button>
          <button 
            onClick={exportToExcel}
            className="px-4 py-2 bg-white border border-brand-border text-brand-text-main rounded-lg text-sm font-bold hover:bg-gray-50 transition-all flex items-center gap-2"
          >
            <Download size={16} />
            Export
          </button>
          <button 
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-bold hover:bg-brand-primary-dark transition-all flex items-center gap-2 shadow-lg shadow-blue-100"
          >
            <Plus size={16} />
            Add Customer
          </button>
        </div>
      </header>

      {/* Advanced Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-brand-border shadow-sm flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted group-focus-within:text-brand-primary transition-colors" size={18} />
          <input 
            type="text"
            placeholder="Search by name, PIC, or email..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary transition-all"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        
        {selectedIds.length > 0 && (
          <button 
            onClick={() => {
              setDeleteTarget({ count: selectedIds.length, ids: [...selectedIds] });
              setShowDeleteConfirm(true);
            }}
            className="px-4 py-2.5 bg-red-50 text-red-600 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-red-100 transition-colors border border-red-100 uppercase tracking-widest"
          >
            <Trash2 size={16} />
            Delete ({selectedIds.length})
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCustomers.map((customer) => (
          <motion.div 
            layout
            key={customer.id} 
            className={`bg-white p-6 rounded-2xl border transition-all group relative overflow-hidden ${selectedIds.includes(customer.id) ? 'border-brand-primary ring-2 ring-brand-primary ring-opacity-10' : 'border-brand-border hover:border-brand-primary hover:shadow-xl hover:shadow-blue-100/30'}`}
          >
            <div className="absolute top-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
              <button onClick={() => { setEditingCust(customer); setShowEdit(true); }} className="p-2 bg-white text-brand-text-muted hover:text-brand-primary rounded-lg border border-brand-border shadow-sm"><Edit2 size={14} /></button>
              <button onClick={() => { setDeleteTarget({ id: customer.id, name: customer.name }); setShowDeleteConfirm(true); }} className="p-2 bg-white text-brand-text-muted hover:text-red-600 rounded-lg border border-brand-border shadow-sm"><Trash2 size={14} /></button>
            </div>

            <div className="flex items-center gap-4 mb-6">
              <div className="relative">
                <input 
                  type="checkbox"
                  className="w-4 h-4 rounded border-brand-border text-brand-primary focus:ring-brand-primary absolute -left-1 -top-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  checked={selectedIds.includes(customer.id)}
                  onChange={() => toggleSelect(customer.id)}
                />
                <div className="w-12 h-12 bg-brand-primary rounded-xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-blue-100">
                  {customer.name.charAt(0)}
                </div>
              </div>
              <div>
                <h3 className="font-bold text-brand-text-main text-lg leading-tight group-hover:text-brand-primary transition-colors">{customer.name}</h3>
                <span className="text-[10px] font-bold text-white bg-brand-primary px-2 py-0.5 rounded uppercase tracking-widest">{customer.category}</span>
              </div>
            </div>

            <div className="space-y-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-brand-text-muted"><Mail size={14} /></div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-brand-text-muted uppercase tracking-widest">Email Address</span>
                  <span className="text-xs font-bold text-brand-text-main">{customer.email}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-brand-text-muted"><Users size={14} /></div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-brand-text-muted uppercase tracking-widest">PIC Information</span>
                  <span className="text-xs font-bold text-brand-text-main">{customer.picName} ({customer.contact})</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-brand-text-muted"><MapPin size={14} /></div>
                <div className="flex flex-col overflow-hidden">
                  <span className="text-[9px] font-bold text-brand-text-muted uppercase tracking-widest">Location</span>
                  <span className="text-xs font-bold text-brand-text-main truncate">{customer.address}</span>
                </div>
              </div>
            </div>

              <div className="flex items-center justify-between border-t border-brand-border pt-4 pb-1">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Skema Bisnis</span>
                  <span className="text-xs font-bold text-brand-primary bg-brand-primary-light px-2 py-0.5 rounded border border-brand-primary/10 w-fit">{customer.scheme || 'Sewa'}</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Lama Kontrak</span>
                  <span className="text-xs font-bold text-brand-text-main">{customer.contractDuration || 0} Bulan</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Estimasi Nilai</span>
                  <span className="text-xs font-black text-brand-text-main">Rp {Number(customer.value || 0).toLocaleString()}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => { setSelectedCust(customer); setShowDetail(true); }}
                className="py-2.5 bg-gray-50 text-brand-text-muted rounded-xl text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-gray-100 transition-colors border border-brand-border flex items-center justify-center gap-2"
              >
                <Eye size={12} />
                Details
              </button>
              <button 
                onClick={() => onViewAssets(customer.id)}
                className="py-2.5 bg-brand-primary-light text-brand-primary rounded-xl text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-brand-primary hover:text-white transition-all border border-brand-primary/10 flex items-center justify-center gap-2"
              >
                Asset Report
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Add/Edit Modal (Patterned after EDCList) */}
      <AnimatePresence>
        {(showAdd || showEdit) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowAdd(false); setShowEdit(false); }} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-brand-border">
              <div className="p-6 border-b border-brand-border bg-gray-50/50 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-brand-text-main">{showAdd ? 'Register New Customer' : 'Edit Customer Information'}</h2>
                  <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-widest mt-1">B2B Management System</p>
                </div>
                <button onClick={() => { setShowAdd(false); setShowEdit(false); }} className="p-2 text-brand-text-muted hover:text-red-500 transition-colors"><X size={20} /></button>
              </div>
              <form onSubmit={showAdd ? handleAdd : handleEdit} className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Customer Name</label>
                    <input required className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary" value={showAdd ? newCust.name : (editingCust?.name || '')} onChange={e => showAdd ? setNewCust({...newCust, name: e.target.value}) : setEditingCust({...editingCust, name: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Category</label>
                    <select className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary cursor-pointer" value={showAdd ? newCust.category : (editingCust?.category || '')} onChange={e => showAdd ? setNewCust({...newCust, category: e.target.value}) : setEditingCust({...editingCust, category: e.target.value})}>
                      <option>Retail</option>
                      <option>Enterprise</option>
                      <option>Government</option>
                      <option>Strategic Partner</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Email</label>
                    <input required type="email" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary" value={showAdd ? newCust.email : (editingCust?.email || '')} onChange={e => showAdd ? setNewCust({...newCust, email: e.target.value}) : setEditingCust({...editingCust, email: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Contact Number</label>
                    <input required className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary" value={showAdd ? newCust.contact : (editingCust?.contact || '')} onChange={e => showAdd ? setNewCust({...newCust, contact: e.target.value}) : setEditingCust({...editingCust, contact: e.target.value})} />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">PIC Name</label>
                    <input required className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary" value={showAdd ? newCust.picName : (editingCust?.picName || '')} onChange={e => showAdd ? setNewCust({...newCust, picName: e.target.value}) : setEditingCust({...editingCust, picName: e.target.value})} />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Office Address</label>
                    <textarea required className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary min-h-[100px]" value={showAdd ? newCust.address : (editingCust?.address || '')} onChange={e => showAdd ? setNewCust({...newCust, address: e.target.value}) : setEditingCust({...editingCust, address: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Skema Bisnis</label>
                    <select className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary cursor-pointer" value={showAdd ? newCust.scheme : (editingCust?.scheme || '')} onChange={e => showAdd ? setNewCust({...newCust, scheme: e.target.value}) : setEditingCust({...editingCust, scheme: e.target.value})}>
                      <option>Sewa</option>
                      <option>Managed Service</option>
                      <option>Jual Putus</option>
                      <option>Pinjam Pakai</option>
                      <option>Konsinyasi</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Nilai Sewa / Unit (IDR)</label>
                    <input type="number" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary" value={showAdd ? newCust.value : (editingCust?.value || 0)} onChange={e => showAdd ? setNewCust({...newCust, value: Number(e.target.value)}) : setEditingCust({...editingCust, value: Number(e.target.value)})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Durasi Kontrak (Bulan)</label>
                    <input type="number" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary" value={showAdd ? newCust.contractDuration : (editingCust?.contractDuration || 0)} onChange={e => showAdd ? setNewCust({...newCust, contractDuration: Number(e.target.value)}) : setEditingCust({...editingCust, contractDuration: Number(e.target.value)})} />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => { setShowAdd(false); setShowEdit(false); }} className="flex-1 py-4 text-sm font-bold text-brand-text-muted bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors border border-brand-border">Batal</button>
                  <button type="submit" className="flex-1 py-4 bg-brand-primary text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-100 uppercase tracking-widest">{showAdd ? 'Register Customer' : 'Save Changes'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {showImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowImport(false)} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-brand-border p-8">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-xl font-bold text-brand-text-main">Bulk Import Customers</h2>
                  <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-widest mt-1">Excel Data Migration</p>
                </div>
                <button onClick={() => setShowImport(false)} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><X size={20} /></button>
              </div>

              <div className="space-y-6">
                <div className="bg-brand-primary-light p-4 rounded-xl border border-brand-primary/20">
                  <p className="text-xs text-brand-text-main leading-relaxed mb-3">Gunakan file Excel untuk menambah banyak data sekaligus. Pastikan header sesuai dengan template.</p>
                  <button onClick={downloadTemplate} className="flex items-center gap-2 text-xs font-bold text-brand-primary hover:underline"><Download size={14} /> Download Template</button>
                </div>

                <label className="block p-10 border-2 border-dashed border-brand-border rounded-xl hover:border-brand-primary transition-all cursor-pointer text-center group bg-gray-50/50">
                  <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleImportExcel} disabled={importLoading} />
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center text-brand-text-muted group-hover:scale-110 group-hover:bg-brand-primary-light group-hover:text-brand-primary shadow-sm transition-all">
                      {importLoading ? <RefreshCw className="animate-spin" size={32} /> : <FileUp size={32} />}
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-brand-text-main">{importLoading ? 'Processing data...' : 'Drop file here or click to browse'}</p>
                      <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-[0.2em]">Supported: .XLSX, .XLS</p>
                    </div>
                  </div>
                </label>

                <button onClick={() => setShowImport(false)} className="w-full py-3 text-xs font-bold text-brand-text-muted uppercase tracking-widest hover:bg-gray-50 rounded-xl transition-colors border border-brand-border">Batal</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !deleting && setShowDeleteConfirm(false)} className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden border border-brand-border p-8 text-center">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 size={32} /></div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Konfirmasi Hapus</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                {deleteTarget && 'name' in deleteTarget 
                  ? `Hapus customer "${deleteTarget.name}"? Segala histori aset terkait akan tetap tersimpan tapi tidak memiliki referensi aktif.`
                  : `Hapus ${deleteTarget && 'count' in deleteTarget ? deleteTarget.count : ''} customer yang dipilih dari database?`
                }
              </p>
              <div className="flex gap-3">
                <button disabled={deleting} onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 text-xs font-bold text-gray-500 uppercase tracking-widest bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors border border-gray-200">Batal</button>
                <button disabled={deleting} onClick={confirmDelete} className="flex-1 py-3 text-xs font-bold text-white uppercase tracking-widest bg-red-600 rounded-xl hover:bg-red-700 shadow-lg shadow-red-100 transition-all flex items-center justify-center gap-2">
                  {deleting ? <RefreshCw size={14} className="animate-spin" /> : 'Ya, Hapus'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {showDetail && selectedCust && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDetail(false)} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-2xl overflow-hidden border border-brand-border">
              <div className="p-8 pb-0 flex justify-between items-start">
                <div className="w-20 h-20 bg-brand-primary rounded-2xl flex items-center justify-center text-white text-3xl font-black shadow-xl shadow-blue-100">
                  {selectedCust.name.charAt(0)}
                </div>
                <button onClick={() => setShowDetail(false)} className="p-2 bg-gray-50 text-brand-text-muted hover:text-red-500 rounded-lg"><X size={20} /></button>
              </div>
              <div className="p-8">
                <div className="mb-8">
                  <h2 className="text-2xl font-bold text-brand-text-main mb-1">{selectedCust.name}</h2>
                  <span className="px-3 py-1 bg-brand-primary-light text-brand-primary text-xs font-bold rounded-full uppercase tracking-widest">{selectedCust.category}</span>
                </div>
                
                <div className="grid grid-cols-1 gap-6 mb-8">
                  <div className="p-4 bg-gray-50 rounded-xl border border-brand-border">
                    <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-2">Primary Contact (PIC)</p>
                    <p className="text-sm font-bold text-brand-text-main">{selectedCust.picName}</p>
                    <p className="text-xs text-brand-text-muted">{selectedCust.contact}</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-xl border border-brand-border">
                    <p className="text-[10px] font-bold text-brand-primary uppercase tracking-widest mb-3">Business Details</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[9px] font-bold text-brand-text-muted uppercase tracking-widest mb-1">Skema Bisnis</p>
                        <p className="text-sm font-black text-brand-primary">{selectedCust.scheme || 'Sewa'}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-bold text-brand-text-muted uppercase tracking-widest mb-1">Nilai Kontrak</p>
                        <p className="text-sm font-black text-brand-text-main">Rp {Number(selectedCust.value || 0).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 pt-4">
                    <div className="flex gap-3">
                      <button 
                        onClick={() => onViewContract(selectedCust.id)}
                        className="flex-1 py-3 bg-brand-primary text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-brand-primary-dark transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
                      >
                        <FileText size={14} />
                        Lihat Kontrak
                      </button>
                      <button 
                        onClick={() => onViewAssets(selectedCust.id)}
                        className="flex-1 py-3 bg-brand-text-main text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2"
                      >
                        <Eye size={14} />
                        Laporan Aset
                      </button>
                    </div>
                    
                    <div className="p-4 bg-gray-50 rounded-xl border border-brand-border">
                      <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-2">Office location</p>
                      <p className="text-sm font-medium text-brand-text-main leading-relaxed">{selectedCust.address}</p>
                    </div>

                    <div className="flex gap-3">
                      <button onClick={() => { setEditingCust(selectedCust); setShowDetail(false); setShowEdit(true); }} className="flex-1 py-3 bg-white border border-brand-border text-brand-text-main text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-gray-50 transition-colors">Edit Pelanggan</button>
                      <button onClick={() => setShowDetail(false)} className="flex-1 py-3 bg-gray-100 text-brand-text-muted text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-gray-200 transition-colors">Tutup</button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
