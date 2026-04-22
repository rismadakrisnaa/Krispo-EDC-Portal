import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, query, orderBy, doc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { MapPin, Warehouse, Store, Wrench, Plus, Search, FileUp, Download, X, Edit2, Trash2, Eye, Filter, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';

export function LocationList() {
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const [newLoc, setNewLoc] = useState({ name: '', type: 'Warehouse', address: '' });
  const [editingLoc, setEditingLoc] = useState<any>(null);
  const [selectedLoc, setSelectedLoc] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string, name: string } | { count: number, ids: string[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'locations'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (s) => {
      setLocations(s.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'locations'), {
        ...newLoc,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setShowAdd(false);
      setNewLoc({ name: '', type: 'Warehouse', address: '' });
    } catch (error) {
      console.error(error);
      alert('Gagal menambah lokasi.');
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLoc) return;
    try {
      const { id, ...data } = editingLoc;
      await updateDoc(doc(db, 'locations', id), {
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
        deleteTarget.ids.forEach(id => batch.delete(doc(db, 'locations', id)));
        await batch.commit();
        setSelectedIds([]);
      } else {
        await deleteDoc(doc(db, 'locations', deleteTarget.id));
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
            const docRef = doc(collection(db, 'locations'));
            batch.set(docRef, {
              name: row['Location Name'] || '',
              type: row['Type'] || 'Warehouse',
              address: row['Address'] || '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          });
          await batch.commit();
        }
        setShowImport(false);
        alert(`Berhasil mengimpor ${data.length} lokasi.`);
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
        'Location Name': 'Gudang Utama Jakarta',
        'Type': 'Warehouse',
        'Address': 'Jl. Kebakaran No. 1, Jakarta Pusat'
      }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Location_Import_Template.xlsx');
  };

  const exportToExcel = () => {
    const dataToExport = locations.map(l => ({
      'Location Name': l.name,
      'Type': l.type,
      'Address': l.address
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Locations');
    XLSX.writeFile(wb, 'Master_Locations_Report.xlsx');
  };

  const filteredLocations = locations.filter(l => 
    l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getIcon = (type: string) => {
    switch (type) {
      case 'Warehouse': return <Warehouse size={18} />;
      case 'Merchant Site': return <Store size={18} />;
      case 'Service Center': return <Wrench size={18} />;
      default: return <MapPin size={18} />;
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-text-main tracking-tight flex items-center gap-3">
            <MapPin className="text-brand-primary" />
            Master Lokasi
          </h1>
          <p className="text-xs text-brand-text-muted font-bold uppercase tracking-widest mt-1">Pengaturan Gudang & Titik Merchant</p>
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
            Tambah Lokasi
          </button>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-brand-border shadow-sm flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted group-focus-within:text-brand-primary transition-colors" size={18} />
          <input 
            type="text"
            placeholder="Cari berdasarkan nama, tipe, atau alamat..."
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
            Hapus ({selectedIds.length})
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredLocations.map((loc) => (
          <motion.div 
            layout
            key={loc.id} 
            className={`bg-white p-5 rounded-xl border transition-all group relative overflow-hidden ${selectedIds.includes(loc.id) ? 'border-brand-primary ring-2 ring-brand-primary ring-opacity-10' : 'border-brand-border hover:border-brand-primary hover:shadow-lg'}`}
          >
            <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
              <button onClick={() => { setEditingLoc(loc); setShowEdit(true); }} className="p-1.5 bg-white text-brand-text-muted hover:text-brand-primary rounded border border-brand-border"><Edit2 size={12} /></button>
              <button onClick={() => { setDeleteTarget({ id: loc.id, name: loc.name }); setShowDeleteConfirm(true); }} className="p-1.5 bg-white text-brand-text-muted hover:text-red-600 rounded border border-brand-border"><Trash2 size={12} /></button>
            </div>

            <div className="flex items-start gap-4">
              <div className="relative">
                <input 
                  type="checkbox"
                  className="w-3.5 h-3.5 rounded border-brand-border text-brand-primary absolute -left-1 -top-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  checked={selectedIds.includes(loc.id)}
                  onChange={() => toggleSelect(loc.id)}
                />
                <div className={`p-2.5 rounded-lg shadow-sm ${loc.type === 'Warehouse' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                  {getIcon(loc.type)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-brand-text-main text-sm truncate group-hover:text-brand-primary transition-colors cursor-pointer" onClick={() => { setSelectedLoc(loc); setShowDetail(true); }}>{loc.name}</h3>
                <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-2 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${loc.type === 'Warehouse' ? 'bg-amber-400' : 'bg-blue-400'}`}></span>
                  {loc.type}
                </p>
                <p className="text-[11px] text-brand-text-muted leading-tight opacity-70 line-clamp-2">{loc.address}</p>
              </div>
            </div>
          </motion.div>
        ))}
        {filteredLocations.length === 0 && !loading && (
          <div className="col-span-full py-12 text-center text-brand-text-muted italic border-2 border-dashed border-brand-border rounded-xl bg-gray-50/50 uppercase text-[10px] font-bold tracking-[0.2em]">
            Tidak ada lokasi yang cocok dengan pencarian.
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAdd || showEdit) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowAdd(false); setShowEdit(false); }} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden border border-brand-border">
              <div className="p-6 border-b border-brand-border bg-gray-50/50 flex justify-between items-center">
                <h2 className="text-lg font-bold text-brand-text-main">{showAdd ? 'Tambah Lokasi Baru' : 'Edit Lokasi'}</h2>
                <button onClick={() => { setShowAdd(false); setShowEdit(false); }} className="p-2 text-brand-text-muted hover:text-red-500 transition-colors"><X size={20} /></button>
              </div>
              <form onSubmit={showAdd ? handleAdd : handleEdit} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Nama Lokasi</label>
                  <input required className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary" value={showAdd ? newLoc.name : (editingLoc?.name || '')} onChange={e => showAdd ? setNewLoc({...newLoc, name: e.target.value}) : setEditingLoc({...editingLoc, name: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Tipe</label>
                  <select className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary cursor-pointer" value={showAdd ? newLoc.type : (editingLoc?.type || 'Warehouse')} onChange={e => showAdd ? setNewLoc({...newLoc, type: e.target.value}) : setEditingLoc({...editingLoc, type: e.target.value})}>
                    <option>Warehouse</option>
                    <option>Merchant Site</option>
                    <option>Service Center</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Alamat Lengkap</label>
                  <textarea required className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary min-h-[100px]" value={showAdd ? newLoc.address : (editingLoc?.address || '')} onChange={e => showAdd ? setNewLoc({...newLoc, address: e.target.value}) : setEditingLoc({...editingLoc, address: e.target.value})} />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => { setShowAdd(false); setShowEdit(false); }} className="flex-1 py-3 text-sm font-bold text-brand-text-muted bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-brand-border">Batal</button>
                  <button type="submit" className="flex-1 py-3 bg-brand-primary text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-100 uppercase tracking-widest transition-all">Simpan</button>
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
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden border border-brand-border p-8 text-center">
              <div className="flex justify-between items-center mb-6">
                <div className="text-left">
                  <h2 className="text-lg font-bold text-brand-text-main">Bulk Import Locations</h2>
                  <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-widest">Excel Master Data</p>
                </div>
                <button onClick={() => setShowImport(false)} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><X size={20} /></button>
              </div>

              <div className="space-y-6">
                <button onClick={downloadTemplate} className="flex items-center gap-2 text-xs font-bold text-brand-primary hover:underline mx-auto"><Download size={14} /> Download Excel Template</button>

                <label className="block p-10 border-2 border-dashed border-brand-border rounded-xl hover:border-brand-primary transition-all cursor-pointer bg-gray-50/50 group">
                  <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleImportExcel} disabled={importLoading} />
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center text-brand-text-muted group-hover:scale-110 group-hover:bg-brand-primary-light group-hover:text-brand-primary shadow-sm transition-all">
                      {importLoading ? <RefreshCw className="animate-spin" size={32} /> : <FileUp size={32} />}
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-brand-text-main">{importLoading ? 'Sedang memproses...' : 'Klik atau tarik file ke sini'}</p>
                      <p className="text-[10px] text-brand-text-muted uppercase tracking-[0.2em] font-bold">.XLSX atau .XLS</p>
                    </div>
                  </div>
                </label>

                <button onClick={() => setShowImport(false)} className="w-full py-3 text-xs font-bold text-brand-text-muted uppercase tracking-widest hover:bg-gray-50 rounded-lg border border-brand-border">Batal</button>
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
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-sm bg-white rounded-xl shadow-2xl overflow-hidden border border-brand-border p-8 text-center">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 size={32} /></div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Konfirmasi Hapus</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                {deleteTarget && 'name' in deleteTarget 
                  ? `Hapus lokasi "${deleteTarget.name}"? Stok perangkat yang ada di lokasi ini perlu dipindahkan ke lokasi lain secara manual.`
                  : `Hapus ${deleteTarget && 'count' in deleteTarget ? deleteTarget.count : ''} lokasi yang dipilih dari database?`
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
        {showDetail && selectedLoc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDetail(false)} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-white rounded-xl overflow-hidden border border-brand-border shadow-2xl">
              <div className="p-6 bg-gray-50 border-b border-brand-border flex items-center gap-4">
                <div className={`p-3 rounded-xl shadow-sm ${selectedLoc.type === 'Warehouse' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                  {getIcon(selectedLoc.type)}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-brand-text-main">{selectedLoc.name}</h2>
                  <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.2em]">{selectedLoc.type}</p>
                </div>
              </div>
              <div className="p-8 space-y-6">
                <div>
                  <p className="text-[10px] font-bold text-brand-primary uppercase tracking-widest mb-3">Address Information</p>
                  <p className="text-sm font-medium text-brand-text-main leading-relaxed bg-gray-50 p-4 rounded-xl border border-brand-border italic">
                    {selectedLoc.address}
                  </p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setEditingLoc(selectedLoc); setShowDetail(false); setShowEdit(true); }} className="flex-1 py-3.5 bg-white border border-brand-border text-brand-text-main text-sm font-bold rounded-xl hover:bg-gray-50 transition-colors uppercase tracking-widest">Edit Lokasi</button>
                  <button onClick={() => setShowDetail(false)} className="flex-1 py-3.5 bg-brand-text-main text-white text-sm font-bold rounded-xl hover:opacity-90 transition-opacity uppercase tracking-widest">Tutup</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
