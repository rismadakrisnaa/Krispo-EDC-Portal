import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { AlertTriangle, Clock, Edit2, Search, Shield, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { db, describeError } from '../lib/firebase';
import { ROLES, ROLE_DESCRIPTIONS, type Role } from '../lib/constants';
import { chunk, cn, matchesSearch } from '../lib/utils';
import type { Invite, UserProfile } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { EmptyState, Field, Modal, PageHeader, btnPrimary, btnSecondary, inputClass, useFeedback } from '../components/ui';

/**
 * Profil yang dibuat fitur "Tambah User" versi lama memakai ID acak (20 karakter),
 * bukan UID akun Google (28 karakter), sehingga tidak pernah terhubung ke akun mana pun.
 */
const isLegacyOrphan = (u: UserProfile) => u.id.length === 20;

// Data operasional yang dihapus saat reset. Akun user & undangan sengaja TIDAK ikut dihapus.
const RESET_COLLECTIONS = ['movements', 'edcs', 'contracts', 'customers', 'locations', 'edc_parts'];

export function UserManagement() {
  const { user: me } = useAuth();
  const { toast, confirm } = useFeedback();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteForm, setInviteForm] = useState<{ email: string; displayName: string; role: string } | null>(null);
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState({ role: 'Management', status: 'Active' });

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), snap => setUsers(snap.docs.map(d => ({ ...d.data(), id: d.id }) as UserProfile)), err => console.error(err));
    const unsubInvites = onSnapshot(collection(db, 'invites'), snap => setInvites(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Invite)), err => console.error(err));
    return () => { unsubUsers(); unsubInvites(); };
  }, []);

  const sortedUsers = useMemo(
    () => users.filter(u => matchesSearch(search, u.displayName, u.email, u.role)).sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '')),
    [users, search],
  );
  const filteredInvites = invites.filter(i => matchesSearch(search, i.displayName, i.email, i.role));

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast(success);
      return true;
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteForm) return;
    const email = inviteForm.email.trim().toLowerCase();
    if (users.some(u => !isLegacyOrphan(u) && (u.email || '').toLowerCase() === email)) return toast(`${email} sudah punya akun aktif. Ubah role-nya lewat tombol edit.`, 'error');
    const ok = await run(
      () => setDoc(doc(db, 'invites', email), { email, displayName: inviteForm.displayName.trim(), role: inviteForm.role, createdAt: serverTimestamp(), createdBy: me?.uid || '' }),
      `${email} diundang sebagai ${inviteForm.role}. Akses aktif saat ia login dengan akun Google tersebut.`,
    );
    if (ok) setInviteForm(null);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const ok = await run(() => updateDoc(doc(db, 'users', editing.id), { role: editForm.role, status: editForm.status, updatedAt: serverTimestamp() }), 'Akses user diperbarui. Perubahan langsung berlaku.');
    if (ok) setEditing(null);
  }

  async function handleDeleteUser(u: UserProfile) {
    if (!(await confirm({ title: 'Hapus user?', danger: true, confirmLabel: 'Ya, Hapus', message: <>Akses <b>{u.displayName || u.email}</b> dicabut. Ia tidak bisa masuk lagi kecuali diundang ulang.</> }))) return;
    run(() => deleteDoc(doc(db, 'users', u.id)), 'User dihapus.');
  }

  /** Ubah profil lama yang tidak terhubung akun menjadi undangan yang benar-benar berfungsi. */
  async function handleConvertOrphan(u: UserProfile) {
    const email = (u.email || '').trim().toLowerCase();
    if (!email) return toast('Profil ini tidak punya email, hapus saja.', 'error');
    run(async () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'invites', email), { email, displayName: u.displayName || '', role: (ROLES as readonly string[]).includes(u.role) ? u.role : 'Management', createdAt: serverTimestamp(), createdBy: me?.uid || '' });
      batch.delete(doc(db, 'users', u.id));
      await batch.commit();
    }, `${email} diubah menjadi undangan.`);
  }

  async function handleReset() {
    const ok = await confirm({
      title: 'Reset semua data operasional?', danger: true, confirmLabel: 'Hapus Semua Data', requireText: 'RESET',
      message: <>Seluruh aset, customer, lokasi, part, kontrak, dan riwayat pergerakan akan dihapus <b>permanen</b>. Akun user & undangan tidak ikut dihapus. Export data lebih dulu jika masih dibutuhkan.</>,
    });
    if (!ok) return;
    run(async () => {
      for (const name of RESET_COLLECTIONS) {
        const snap = await getDocs(collection(db, name));
        for (const group of chunk(snap.docs, 400)) {
          const batch = writeBatch(db);
          group.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
    }, 'Semua data operasional sudah dihapus.');
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={ShieldCheck} title="User & Role" subtitle="Hanya email yang diundang di sini yang bisa masuk aplikasi">
        <button onClick={() => setInviteForm({ email: '', displayName: '', role: 'Operations' })} className={btnPrimary}><UserPlus size={16} /> Undang User</button>
      </PageHeader>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted" size={16} />
        <input type="search" aria-label="Cari user" className={cn(inputClass, 'pl-10 bg-white')} placeholder="Cari nama, email, role..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
            <div className="px-5 py-3 border-b border-brand-border bg-gray-50/50 text-[10px] font-black text-brand-text-muted uppercase tracking-[0.2em]">User Terdaftar ({sortedUsers.length})</div>
            {sortedUsers.length === 0 ? <EmptyState icon={Shield} title="Tidak ada user yang cocok" /> : (
              <ul className="divide-y divide-brand-border">
                {sortedUsers.map(u => {
                  const isMe = u.id === me?.uid;
                  const orphan = isLegacyOrphan(u);
                  return (
                    <li key={u.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-brand-primary-light text-brand-primary flex items-center justify-center font-black text-sm shrink-0">{(u.displayName || u.email || '?').charAt(0).toUpperCase()}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-brand-text-main truncate">{u.displayName || '-'} {isMe && <span className="text-[10px] font-black text-brand-primary">(Anda)</span>}</p>
                        <p className="text-xs text-brand-text-muted truncate">{u.email}</p>
                        {orphan && <p className="text-[10px] font-bold text-amber-700 mt-0.5">Data lama: tidak terhubung ke akun Google, user ini tidak pernah mendapat akses.</p>}
                      </div>
                      <span className="text-[10px] font-black text-brand-primary bg-brand-primary-light px-2 py-0.5 rounded border border-brand-primary/10 uppercase tracking-wide">{u.role}</span>
                      {u.status === 'Inactive' && <span className="text-[10px] font-black text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200 uppercase">Nonaktif</span>}
                      <div className="flex gap-1.5">
                        {orphan ? (
                          <button disabled={busy} onClick={() => handleConvertOrphan(u)} className="px-2.5 py-1.5 text-[10px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100">Jadikan Undangan</button>
                        ) : !isMe && (
                          <button disabled={busy} onClick={() => { setEditing(u); setEditForm({ role: u.role, status: u.status || 'Active' }); }} aria-label={`Edit ${u.email}`} className="p-1.5 text-brand-text-muted hover:text-brand-primary border border-brand-border rounded"><Edit2 size={14} /></button>
                        )}
                        {!isMe && <button disabled={busy} onClick={() => handleDeleteUser(u)} aria-label={`Hapus ${u.email}`} className="p-1.5 text-brand-text-muted hover:text-red-600 border border-brand-border rounded"><Trash2 size={14} /></button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
            <div className="px-5 py-3 border-b border-brand-border bg-gray-50/50 text-[10px] font-black text-brand-text-muted uppercase tracking-[0.2em] flex items-center gap-2"><Clock size={13} /> Undangan Menunggu Login ({filteredInvites.length})</div>
            {filteredInvites.length === 0 ? (
              <p className="px-5 py-6 text-xs text-brand-text-muted text-center">Tidak ada undangan tertunda.</p>
            ) : (
              <ul className="divide-y divide-brand-border">
                {filteredInvites.map(invite => (
                  <li key={invite.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-brand-text-main truncate">{invite.displayName || '-'}</p>
                      <p className="text-xs text-brand-text-muted truncate">{invite.email}</p>
                    </div>
                    <span className="text-[10px] font-black text-brand-primary bg-brand-primary-light px-2 py-0.5 rounded border border-brand-primary/10 uppercase tracking-wide">{invite.role}</span>
                    <button
                      disabled={busy} aria-label={`Batalkan undangan ${invite.email}`}
                      onClick={() => run(() => deleteDoc(doc(db, 'invites', invite.id)), 'Undangan dibatalkan.')}
                      className="p-1.5 text-brand-text-muted hover:text-red-600 border border-brand-border rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-5 rounded-xl border border-brand-border space-y-3">
            <h3 className="text-[10px] font-black text-brand-text-main uppercase tracking-[0.2em] flex items-center gap-2"><Shield size={14} className="text-brand-primary" /> Hak Akses per Role</h3>
            {ROLES.map(role => (
              <div key={role} className="p-3 bg-gray-50/60 rounded-lg border border-brand-border">
                <p className="text-xs font-bold text-brand-text-main">{role}</p>
                <p className="text-[11px] text-brand-text-muted leading-relaxed">{ROLE_DESCRIPTIONS[role as Role]}</p>
              </div>
            ))}
          </div>

          <div className="bg-red-50 p-5 rounded-xl border border-red-100 space-y-3">
            <h3 className="text-[10px] font-black text-red-600 uppercase tracking-[0.2em] flex items-center gap-2"><AlertTriangle size={14} /> Zona Bahaya</h3>
            <p className="text-[11px] text-red-700 leading-relaxed">Menghapus seluruh data operasional (aset, customer, lokasi, part, kontrak, riwayat). Tidak bisa dibatalkan.</p>
            <button disabled={busy} onClick={handleReset} className="w-full py-2.5 bg-red-600 text-white rounded-lg text-[11px] font-black uppercase tracking-widest hover:bg-red-700 disabled:opacity-50">Reset Data Operasional</button>
          </div>
        </div>
      </div>

      <Modal open={!!inviteForm} onClose={() => setInviteForm(null)} busy={busy} title="Undang User" subtitle="Akses diberikan berdasarkan email akun Google">
        {inviteForm && (
          <form onSubmit={handleInvite} className="p-6 space-y-4">
            <Field label="Email Akun Google" hint="Harus sama persis dengan email yang dipakai login.">
              <input required type="email" maxLength={128} className={inputClass} value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })} />
            </Field>
            <Field label="Nama Lengkap"><input required maxLength={200} className={inputClass} value={inviteForm.displayName} onChange={e => setInviteForm({ ...inviteForm, displayName: e.target.value })} /></Field>
            <Field label="Role" hint={ROLE_DESCRIPTIONS[inviteForm.role as Role]}>
              <select className={inputClass} value={inviteForm.role} onChange={e => setInviteForm({ ...inviteForm, role: e.target.value })}>{ROLES.map(r => <option key={r}>{r}</option>)}</select>
            </Field>
            <div className="flex gap-3 pt-2">
              <button type="button" disabled={busy} onClick={() => setInviteForm(null)} className={cn(btnSecondary, 'flex-1 py-3')}>Batal</button>
              <button type="submit" disabled={busy} className={cn(btnPrimary, 'flex-1 py-3')}>{busy ? 'Menyimpan...' : 'Kirim Undangan'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} busy={busy} title="Ubah Akses User" subtitle={editing?.email}>
        <form onSubmit={handleEdit} className="p-6 space-y-4">
          <Field label="Role" hint={ROLE_DESCRIPTIONS[editForm.role as Role]}>
            <select className={inputClass} value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })}>
              {!(ROLES as readonly string[]).includes(editForm.role) && <option value={editForm.role}>{editForm.role} (tidak valid)</option>}
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Status" hint="User nonaktif langsung kehilangan akses tanpa menghapus datanya.">
            <select className={inputClass} value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
              <option value="Active">Aktif</option>
              <option value="Inactive">Nonaktif</option>
            </select>
          </Field>
          <div className="flex gap-3 pt-2">
            <button type="button" disabled={busy} onClick={() => setEditing(null)} className={cn(btnSecondary, 'flex-1 py-3')}>Batal</button>
            <button type="submit" disabled={busy} className={cn(btnPrimary, 'flex-1 py-3')}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
