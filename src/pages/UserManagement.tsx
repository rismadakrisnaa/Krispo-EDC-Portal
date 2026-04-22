import React, { useState, useEffect } from 'react';
import { Shield, User, Mail, ShieldCheck, UserPlus, Key, Search, FileUp, Download, X, Edit2, Trash2, Eye, RefreshCw, Filter, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot, query, orderBy, addDoc, serverTimestamp, doc, updateDoc, deleteDoc, writeBatch, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import * as XLSX from 'xlsx';

export function UserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  
  const [newUser, setNewUser] = useState({ displayName: '', email: '', role: 'Operations', status: 'Active' });
  const [editingUser, setEditingUser] = useState<any>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string, name: string } | { count: number, ids: string[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  const roles = ['Admin', 'Warehouse', 'Operations', 'Account Manager', 'Service', 'Management'];

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('displayName', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'users'), {
        ...newUser,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setShowAdd(false);
      setNewUser({ displayName: '', email: '', role: 'Operations', status: 'Active' });
    } catch (error) {
      console.error(error);
      alert('Gagal menambah user.');
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      const { id, ...data } = editingUser;
      await updateDoc(doc(db, 'users', id), {
        ...data,
        updatedAt: serverTimestamp()
      });
      setShowEdit(false);
    } catch (error) {
      console.error(error);
      alert('Gagal update user.');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if ('ids' in deleteTarget) {
        const batch = writeBatch(db);
        deleteTarget.ids.forEach(id => batch.delete(doc(db, 'users', id)));
        await batch.commit();
        setSelectedIds([]);
      } else {
        await deleteDoc(doc(db, 'users', deleteTarget.id));
      }
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    } catch (error) {
      console.error(error);
      alert('Gagal menghapus user.');
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
            const docRef = doc(collection(db, 'users'));
            batch.set(docRef, {
              displayName: row['Full Name'] || '',
              email: row['Email'] || '',
              role: row['Role'] || 'Operations',
              status: 'Active',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          });
          await batch.commit();
        }
        setShowImport(false);
        alert(`Berhasil mengimpor ${data.length} user.`);
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
        'Full Name': 'Budi Santoso',
        'Email': 'budi@artajasa.co.id',
        'Role': 'Operations'
      }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'User_Import_Template.xlsx');
  };

  const exportToExcel = () => {
    const dataToExport = users.map(u => ({
      'Full Name': u.displayName,
      'Email': u.email,
      'Role': u.role,
      'Status': u.status
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    XLSX.writeFile(wb, 'Internal_Users_Report.xlsx');
  };

  const handleResetDatabase = async () => {
    setResetting(true);
    try {
      const collectionsToClear = ['edcs', 'customers', 'locations', 'contracts', 'movements', 'edc_parts', 'users'];
      
      for (const colName of collectionsToClear) {
        const snapshot = await getDocs(collection(db, colName));
        if (snapshot.empty) continue;

        const chunks = [];
        for (let i = 0; i < snapshot.docs.length; i += 500) {
          chunks.push(snapshot.docs.slice(i, i + 500));
        }

        for (const chunk of chunks) {
          const batch = writeBatch(db);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      
      setShowResetConfirm(false);
      alert('Pembersihan data selesai. Semua koleksi database telah dikosongkan.');
      window.location.reload(); // Force reload to trigger App.tsx re-creation of admin user if necessary
    } catch (error) {
      console.error(error);
      alert('Gagal membersihkan database.');
    } finally {
      setResetting(false);
    }
  };

  const filteredUsers = users.filter(u => 
    u.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-text-main tracking-tight flex items-center gap-3 uppercase">
            <ShieldCheck className="text-brand-primary" />
            User & Role Management
          </h1>
          <p className="text-xs text-brand-text-muted font-bold uppercase tracking-widest mt-1">Kelola Hak Akses Tim ARTAJASA</p>
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
            <UserPlus size={16} />
            Tambah User
          </button>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-brand-border shadow-sm flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted group-focus-within:text-brand-primary transition-colors" size={18} />
          <input 
            type="text"
            placeholder="Search by name, email, or role..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary transition-all font-medium"
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-brand-border shadow-sm overflow-hidden flex flex-col min-h-[500px]">
            <div className="px-6 py-4 border-b border-brand-border bg-[#F8FAFC]/50 flex items-center justify-between">
              <h3 className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.2em] flex items-center gap-2">
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                Internal User List
              </h3>
            </div>
            <div className="divide-y divide-brand-border">
              {filteredUsers.map((u) => (
                <div key={u.id} className={`p-5 flex items-center justify-between hover:bg-gray-50 transition-all group ${selectedIds.includes(u.id) ? 'bg-brand-primary-light/10' : ''}`}>
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <input 
                        type="checkbox"
                        className="w-4 h-4 rounded border-brand-border text-brand-primary absolute -left-2 -top-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        checked={selectedIds.includes(u.id)}
                        onChange={() => toggleSelect(u.id)}
                      />
                      <div className="w-12 h-12 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary font-bold text-lg border border-brand-primary/20">
                        {u.displayName?.charAt(0) || <User />}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-brand-text-main group-hover:text-brand-primary transition-colors cursor-pointer" onClick={() => { setSelectedUser(u); setShowDetail(true); }}>{u.displayName}</p>
                      <p className="text-xs text-brand-text-muted font-medium">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="px-3 py-1 bg-white text-[10px] font-bold uppercase tracking-widest rounded-full border border-brand-border text-brand-text-muted shadow-sm">
                      {u.role}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                      <button onClick={() => { setEditingUser(u); setShowEdit(true); }} className="p-2 text-brand-text-muted hover:text-brand-primary hover:bg-white rounded-lg transition-colors border border-transparent hover:border-brand-border"><Edit2 size={14} /></button>
                      <button onClick={() => { setDeleteTarget({ id: u.id, name: u.displayName }); setShowDeleteConfirm(true); }} className="p-2 text-brand-text-muted hover:text-red-500 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-brand-border"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredUsers.length === 0 && !loading && (
                <div className="py-20 text-center text-brand-text-muted italic flex flex-col items-center gap-3">
                  <Search size={40} className="opacity-10" />
                  <p className="text-[10px] uppercase font-bold tracking-widest">User tidak ditemukan</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-8 rounded-2xl border border-brand-border shadow-sm flex flex-col gap-6">
            <h3 className="text-[10px] font-bold text-brand-text-main uppercase tracking-widest flex items-center gap-3 border-b border-brand-border pb-4">
              <Shield size={16} className="text-brand-primary" />
              Role Permissions Matrix
            </h3>
            <div className="space-y-4">
              {roles.map((role, i) => (
                <div key={i} className="flex flex-col gap-2 p-4 bg-gray-50/50 rounded-xl border border-brand-border hover:border-brand-primary transition-colors transition-all group">
                  <span className="text-xs font-bold text-brand-text-main group-hover:text-brand-primary">{role}</span>
                  <p className="text-[11px] text-brand-text-muted leading-relaxed font-medium">
                    {role === 'Admin' ? 'Akses penuh ke semua master data dan manajemen user.' : 
                     role === 'Warehouse' ? 'Kelola stok masuk, ketersediaan gudang, dan peripheral.' :
                     role === 'Operations' ? 'Eksekusi pergerakan EDC, update status, dan monitoring lapangan.' :
                     'Akses terbatas sesuai fungsi pelaporan operasional.'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-red-50 p-8 rounded-2xl border border-red-100 shadow-sm flex flex-col gap-6">
            <h3 className="text-[10px] font-bold text-red-600 uppercase tracking-widest flex items-center gap-3 border-b border-red-200 pb-4">
              <RefreshCw size={16} />
              System Maintenance
            </h3>
            <div className="space-y-4">
              <div className="p-4 bg-white rounded-xl border border-red-100">
                <p className="text-[11px] text-red-800 leading-relaxed font-bold uppercase mb-3 tracking-tight">Database Master Reset</p>
                <p className="text-[10px] text-red-600 mb-4 opacity-80 leading-relaxed">ZONA BAHAYA: Menghapus seluruh data EDC, Customer, Kontrak, Pergerakan, dan User. Tindakan ini tidak dapat dibatalkan.</p>
                <button 
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full py-2.5 bg-red-600 text-white rounded-lg text-[11px] font-black uppercase tracking-widest hover:bg-red-700 transition-all shadow-md shadow-red-100"
                >
                  Reset All Data
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Database Reset Modal */}
      <AnimatePresence>
        {showResetConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !resetting && setShowResetConfirm(false)} className="absolute inset-0 bg-red-950/40 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden border border-red-100 p-8 text-center">
              <div className="w-16 h-16 bg-red-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-red-200"><RefreshCw size={32} className={resetting ? 'animate-spin' : ''} /></div>
              <h3 className="text-xl font-black text-gray-900 mb-2 uppercase tracking-tighter">Full Database Wipe</h3>
              <p className="text-xs text-red-600 mb-8 leading-relaxed font-bold uppercase opacity-80 decoration-red-600">
                PERINGATAN: Seluruh data operasional ArtaJasa akan dihapus secara permanen. Admin user akan diregenerasi ulang saat login berikutnya.
              </p>
              <div className="flex flex-col gap-3">
                <button disabled={resetting} onClick={handleResetDatabase} className="w-full py-4 bg-red-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-red-700 shadow-lg shadow-red-100 flex items-center justify-center gap-2">
                  {resetting ? 'Wiping Database...' : 'Ya, Bersihkan Semua Data'}
                </button>
                <button disabled={resetting} onClick={() => setShowResetConfirm(false)} className="w-full py-3 text-brand-text-muted text-[10px] font-black uppercase tracking-widest hover:bg-gray-100 rounded-xl transition-colors">Batalkan</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAdd || showEdit) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowAdd(false); setShowEdit(false); }} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-brand-border">
              <div className="p-6 bg-gray-50 border-b border-brand-border flex justify-between items-center">
                <h2 className="text-lg font-bold text-brand-text-main uppercase tracking-tight">{showAdd ? 'Tambah User Baru' : 'Edit User Profile'}</h2>
                <button onClick={() => { setShowAdd(false); setShowEdit(false); }} className="p-2 text-brand-text-muted hover:text-red-500 transition-colors"><X size={20} /></button>
              </div>
              <form onSubmit={showAdd ? handleAdd : handleEdit} className="p-8 space-y-6">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Nama Lengkap</label>
                  <input required className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-xl text-sm font-bold text-brand-text-main outline-none focus:ring-1 focus:ring-brand-primary" value={showAdd ? newUser.displayName : (editingUser?.displayName || '')} onChange={e => showAdd ? setNewUser({...newUser, displayName: e.target.value}) : setEditingUser({...editingUser, displayName: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Email Internal</label>
                  <input required type="email" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-xl text-sm font-bold text-brand-text-main outline-none focus:ring-1 focus:ring-brand-primary" value={showAdd ? newUser.email : (editingUser?.email || '')} onChange={e => showAdd ? setNewUser({...newUser, email: e.target.value}) : setEditingUser({...editingUser, email: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Akses Role</label>
                  <select className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-xl text-sm font-bold text-brand-text-main outline-none focus:ring-1 focus:ring-brand-primary cursor-pointer" value={showAdd ? newUser.role : (editingUser?.role || 'Service')} onChange={e => showAdd ? setNewUser({...newUser, role: e.target.value}) : setEditingUser({...editingUser, role: e.target.value})}>
                    {roles.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => { setShowAdd(false); setShowEdit(false); }} className="flex-1 py-4 text-xs font-bold text-brand-text-muted uppercase tracking-widest bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors border border-brand-border">Batal</button>
                  <button type="submit" className="flex-1 py-4 bg-brand-primary text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-100 uppercase tracking-widest transition-all">Simpan User</button>
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
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-brand-border p-8 text-center">
              <div className="flex justify-between items-center mb-6">
                <div className="text-left font-bold text-brand-text-main uppercase tracking-tight">Bulk Import Users</div>
                <button onClick={() => setShowImport(false)} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><X size={20} /></button>
              </div>
              <div className="space-y-6">
                <button onClick={downloadTemplate} className="flex items-center gap-2 text-xs font-black text-brand-primary hover:underline mx-auto uppercase tracking-tighter"><Download size={14} /> Download Template Excel</button>
                <label className="block p-10 border-2 border-dashed border-brand-border rounded-2xl hover:border-brand-primary transition-all cursor-pointer bg-gray-50/50 group">
                  <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleImportExcel} disabled={importLoading} />
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-white border border-brand-border flex items-center justify-center text-brand-text-muted group-hover:scale-110 group-hover:bg-brand-primary-light group-hover:text-brand-primary shadow-sm transition-all">
                      {importLoading ? <RefreshCw className="animate-spin" size={32} /> : <FileUp size={32} />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-brand-text-main tracking-tight uppercase">{importLoading ? 'Memproses Data...' : 'Pilih File Excel'}</p>
                      <p className="text-[10px] text-brand-text-muted font-bold mt-1 uppercase tracking-widest italic opacity-60">Dukung: .xlsx, .xls</p>
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
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100 shadow-sm"><Trash2 size={32} /></div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Konfirmasi Hapus</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed font-medium">
                {deleteTarget && 'name' in deleteTarget 
                  ? `Hapus user "${deleteTarget.name}"? Akses login user ini akan langsung dicabut.`
                  : `Hapus ${deleteTarget && 'count' in deleteTarget ? deleteTarget.count : ''} user yang dipilih?`
                }
              </p>
              <div className="flex gap-3 text-[11px] font-black uppercase tracking-widest">
                <button disabled={deleting} onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 text-brand-text-muted bg-gray-50 rounded-xl hover:bg-gray-100 border border-brand-border">Batal</button>
                <button disabled={deleting} onClick={confirmDelete} className="flex-1 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 shadow-lg shadow-red-100 flex items-center justify-center gap-2">
                  {deleting ? <RefreshCw size={14} className="animate-spin" /> : 'Ya, Hapus'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {showDetail && selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDetail(false)} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-white rounded-2xl overflow-hidden border border-brand-border shadow-2xl">
              <div className="p-10 flex flex-col items-center text-center">
                <div className="w-24 h-24 bg-brand-primary-light rounded-2xl flex items-center justify-center text-brand-primary text-4xl font-black shadow-xl shadow-blue-100 mb-6 border border-brand-primary/10">
                  {selectedUser.displayName?.charAt(0) || <User size={48} />}
                </div>
                <h2 className="text-2xl font-bold text-brand-text-main mb-1">{selectedUser.displayName}</h2>
                <div className="flex items-center gap-2 mb-8">
                  <span className="px-3 py-1 bg-brand-primary text-white text-[10px] font-bold uppercase tracking-widest rounded-full">{selectedUser.role}</span>
                  <span className="px-3 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-widest rounded-full border border-emerald-100 flex items-center gap-1">
                    <CheckCircle2 size={10} /> {selectedUser.status || 'Active'}
                  </span>
                </div>
                
                <div className="w-full space-y-4 mb-8">
                  <div className="p-4 bg-gray-50 rounded-xl border border-brand-border text-left">
                    <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-1">Email Internal</p>
                    <p className="text-sm font-bold text-brand-text-main">{selectedUser.email}</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-xl border border-brand-border text-left">
                    <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest mb-1">User ID (Access Key)</p>
                    <p className="text-[11px] font-mono text-brand-text-main break-all">{selectedUser.id}</p>
                  </div>
                </div>

                <div className="flex gap-4 w-full">
                  <button onClick={() => { setEditingUser(selectedUser); setShowDetail(false); setShowEdit(true); }} className="flex-1 py-3.5 bg-white border border-brand-border text-brand-text-main text-xs font-black uppercase tracking-widest rounded-xl hover:bg-gray-50 transition-colors">Edit User Profile</button>
                  <button onClick={() => setShowDetail(false)} className="flex-1 py-3.5 bg-brand-primary text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg shadow-blue-100 hover:opacity-90 transition-opacity">Tutup</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
