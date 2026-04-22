import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, addDoc, serverTimestamp, doc, updateDoc, deleteDoc, writeBatch, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Plus, Settings, X, Search, FileUp, Download, Edit2, Trash2, RefreshCw, AlertTriangle, Package } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';

export function MasterParts() {
  const [parts, setParts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [newPart, setNewPart] = useState({
    name: '',
    price: 0,
    description: ''
  });
  
  const [editingPart, setEditingPart] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string, name: string } | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'edc_parts'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setParts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    try {
      await addDoc(collection(db, 'edc_parts'), {
        ...newPart,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setShowAdd(false);
      setNewPart({ name: '', price: 0, description: '' });
    } catch (error) {
      console.error(error);
      alert('Gagal menambah part.');
    } finally {
      setProcessing(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPart) return;
    setProcessing(true);
    try {
      const { id, ...data } = editingPart;
      await updateDoc(doc(db, 'edc_parts', id), {
        ...data,
        updatedAt: serverTimestamp()
      });
      setShowEdit(false);
    } catch (error) {
      console.error(error);
      alert('Gagal update part.');
    } finally {
      setProcessing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setProcessing(true);
    try {
      await deleteDoc(doc(db, 'edc_parts', deleteTarget.id));
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    } catch (error) {
      console.error(error);
      alert('Gagal menghapus part.');
    } finally {
      setProcessing(false);
    }
  };

  const filteredParts = parts.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
       <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-text-main tracking-tight flex items-center gap-3 uppercase">
              <Settings className="text-brand-primary" />
              Master Part EDC
            </h1>
            <p className="text-xs text-brand-text-muted font-bold uppercase tracking-widest mt-1">Daftar Komponen & Harga Penggantian</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
             <button 
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-bold hover:bg-brand-primary-dark transition-all flex items-center gap-2 shadow-lg shadow-blue-100"
            >
              <Plus size={16} />
              Tambah Part
            </button>
          </div>
        </header>

        <div className="bg-white p-4 rounded-xl border border-brand-border shadow-sm flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-1 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted group-focus-within:text-brand-primary transition-colors" size={18} />
            <input 
              type="text"
              placeholder="Cari nama part..."
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary transition-all font-medium"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredParts.map((part) => (
            <div key={part.id} className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
               <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                  <button onClick={() => { setEditingPart(part); setShowEdit(true); }} className="p-2 bg-white border border-brand-border text-brand-text-muted hover:text-brand-primary rounded-lg shadow-sm"><Edit2 size={14} /></button>
                  <button onClick={() => { setDeleteTarget({ id: part.id, name: part.name }); setShowDeleteConfirm(true); }} className="p-2 bg-white border border-brand-border text-brand-text-muted hover:text-red-600 rounded-lg shadow-sm"><Trash2 size={14} /></button>
               </div>
               
               <div className="w-12 h-12 bg-brand-primary-light text-brand-primary rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                 <Package size={24} />
               </div>
               
               <h3 className="font-black text-brand-text-main text-lg uppercase mb-1">{part.name}</h3>
               <p className="text-xs text-brand-text-muted font-medium mb-4 min-h-[32px]">{part.description || 'Tidak ada deskripsi'}</p>
               
               <div className="pt-4 border-t border-brand-border flex items-center justify-between">
                 <div className="flex flex-col">
                   <span className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Harga Ganti (IDR)</span>
                   <span className="text-xl font-black text-brand-primary">Rp {Number(part.price || 0).toLocaleString()}</span>
                 </div>
               </div>
            </div>
          ))}
          
          {filteredParts.length === 0 && !loading && (
             <div className="col-span-full py-20 text-center bg-gray-50/50 rounded-2xl border-2 border-dashed border-brand-border flex flex-col items-center">
               <AlertTriangle size={48} className="text-brand-text-muted opacity-20 mb-4" />
               <p className="text-brand-text-muted text-xs font-bold uppercase tracking-widest">Master part tidak ditemukan</p>
             </div>
          )}
        </div>

        {/* Add/Edit Modal */}
        <AnimatePresence>
          {(showAdd || showEdit) && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowAdd(false); setShowEdit(false); }} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-brand-border p-8">
                <div className="flex justify-between items-center mb-8">
                  <h2 className="font-black text-brand-text-main text-xl uppercase tracking-tight">{showAdd ? 'Tambah Part Baru' : 'Edit Part EDC'}</h2>
                  <button onClick={() => { setShowAdd(false); setShowEdit(false); }} className="p-2 text-brand-text-muted hover:text-red-500 transition-colors"><X size={20} /></button>
                </div>
                
                <form onSubmit={showAdd ? handleAdd : handleEdit} className="space-y-5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Nama Part / Komponen</label>
                    <input required className="w-full px-4 py-3 bg-gray-50 border border-brand-border rounded-xl text-sm font-bold text-brand-text-main outline-none focus:ring-1 focus:ring-brand-primary" placeholder="e.g. Charger EDC" value={showAdd ? newPart.name : (editingPart?.name || '')} onChange={e => showAdd ? setNewPart({...newPart, name: e.target.value}) : setEditingPart({...editingPart, name: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Harga Penggantian (IDR)</label>
                    <input required type="number" className="w-full px-4 py-3 bg-gray-50 border border-brand-border rounded-xl text-sm font-bold text-brand-text-main outline-none focus:ring-1 focus:ring-brand-primary" value={showAdd ? newPart.price : (editingPart?.price || 0)} onChange={e => showAdd ? setNewPart({...newPart, price: Number(e.target.value)}) : setEditingPart({...editingPart, price: Number(e.target.value)})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Deskripsi Singkat</label>
                    <textarea className="w-full px-4 py-3 bg-gray-50 border border-brand-border rounded-xl text-sm font-medium text-brand-text-main outline-none focus:ring-1 focus:ring-brand-primary min-h-[100px]" placeholder="Penjelasan part..." value={showAdd ? newPart.description : (editingPart?.description || '')} onChange={e => showAdd ? setNewPart({...newPart, description: e.target.value}) : setEditingPart({...editingPart, description: e.target.value})} />
                  </div>
                  
                  <div className="flex gap-4 pt-4">
                    <button type="button" onClick={() => { setShowAdd(false); setShowEdit(false); }} className="flex-1 py-4 text-xs font-black text-brand-text-muted uppercase tracking-widest bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors border border-brand-border">Batal</button>
                    <button type="submit" disabled={processing} className="flex-1 py-4 bg-brand-primary text-white text-xs font-black rounded-xl shadow-lg shadow-blue-100 uppercase tracking-widest transition-all">
                       {processing ? <RefreshCw className="animate-spin mx-auto" size={16} /> : 'Simpan Part'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Delete Confirmation */}
        <AnimatePresence>
          {showDeleteConfirm && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !processing && setShowDeleteConfirm(false)} className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-8 text-center">
                <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100 shadow-sm"><Trash2 size={32} /></div>
                <h3 className="text-xl font-black text-gray-900 mb-2">Hapus Part?</h3>
                <p className="text-sm text-gray-500 mb-8 font-medium">Menghapus "{deleteTarget?.name}" tidak akan mempengaruhi denda yang sudah tercatat sebelumnya.</p>
                <div className="flex gap-3">
                  <button disabled={processing} onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 text-xs font-black text-brand-text-muted uppercase tracking-widest bg-gray-50 rounded-xl hover:bg-gray-100 border border-brand-border">Batal</button>
                  <button disabled={processing} onClick={confirmDelete} className="flex-1 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 shadow-lg text-xs font-black uppercase tracking-widest">
                    {processing ? <RefreshCw size={14} className="animate-spin mx-auto" /> : 'Ya, Hapus'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
    </div>
  );
}
