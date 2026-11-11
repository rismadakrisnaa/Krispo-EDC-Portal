import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { AlertTriangle, Copy, Edit2, KeyRound, RefreshCw, Search, Shield, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { createLoginAccount, db, describeError } from '../lib/firebase';
import { LOGIN_EMAIL_DOMAIN, MIN_PASSWORD_LENGTH, ROLES, ROLE_DESCRIPTIONS, USERNAME_PATTERN, loginEmailFor, normalizeUsername, type Role } from '../lib/constants';
import { chunk, cn, matchesSearch } from '../lib/utils';
import type { UserProfile } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { EmptyState, Field, Modal, PageHeader, btnPrimary, btnSecondary, inputClass, useFeedback } from '../components/ui';

// Data operasional yang dihapus saat reset. Akun user sengaja TIDAK ikut dihapus.
const RESET_COLLECTIONS = ['movements', 'approvals', 'attachment_data', 'attachments', 'edcs', 'contracts', 'customers', 'locations', 'edc_parts', 'suppliers', 'device_models'];

/** Profil tanpa username berasal dari versi lama (login Google) dan tidak bisa dipakai login lagi. */
const isLegacy = (u: UserProfile) => !u.username || !(u.email || '').endsWith(`@${LOGIN_EMAIL_DOMAIN}`);

/** Password sementara yang mudah dibacakan: tanpa karakter mirip (0/O, 1/l/I). */
function generatePassword(length = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, v => chars[v % chars.length]).join('');
}

const emptyCreate = () => ({ username: '', displayName: '', role: 'Operations', password: generatePassword() });

export function UserManagement() {
  const { user: me } = useAuth();
  const { toast, confirm } = useFeedback();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [createForm, setCreateForm] = useState<ReturnType<typeof emptyCreate> | null>(null);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', role: 'Management', status: 'Active' });

  useEffect(
    () => onSnapshot(collection(db, 'users'), snap => setUsers(snap.docs.map(d => ({ ...d.data(), id: d.id }) as UserProfile)), err => console.error(err)),
    [],
  );

  const sortedUsers = useMemo(
    () => users
      .filter(u => matchesSearch(search, u.displayName, u.username, u.email, u.role))
      .sort((a, b) => Number(isLegacy(a)) - Number(isLegacy(b)) || (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '')),
    [users, search],
  );

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await action();
      if (success) toast(success);
      return true;
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm) return;
    const username = normalizeUsername(createForm.username);
    if (!USERNAME_PATTERN.test(username)) return toast('Username 3-32 karakter: huruf kecil, angka, titik, minus, atau garis bawah, diawali huruf/angka.', 'error');
    if (createForm.password.length < MIN_PASSWORD_LENGTH) return toast(`Password minimal ${MIN_PASSWORD_LENGTH} karakter.`, 'error');
    if (users.some(u => u.username === username)) return toast(`Username "${username}" sudah dipakai.`, 'error');

    const ok = await run(async () => {
      const uid = await createLoginAccount(username, createForm.password);
      await setDoc(doc(db, 'users', uid), {
        email: loginEmailFor(username),
        username,
        displayName: createForm.displayName.trim(),
        role: createForm.role,
        status: 'Active',
        mustChangePassword: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    if (ok) {
      setCreated({ username, password: createForm.password });
      setCreateForm(null);
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const ok = await run(
      () => updateDoc(doc(db, 'users', editing.id), { displayName: editForm.displayName.trim(), role: editForm.role, status: editForm.status, updatedAt: serverTimestamp() }),
      'Akun diperbarui. Perubahan langsung berlaku.',
    );
    if (ok) setEditing(null);
  }

  async function handleDelete(u: UserProfile) {
    const label = u.username ? `@${u.username}` : u.email;
    const ok = await confirm({
      title: 'Hapus akun?', danger: true, confirmLabel: 'Ya, Hapus',
      message: isLegacy(u)
        ? <>Profil lama <b>{label}</b> akan dihapus.</>
        : <>Akses <b>{label}</b> dicabut permanen. Username ini <b>tidak bisa dipakai lagi</b> untuk akun baru. Kalau hanya ingin memblokir sementara, ubah status menjadi Nonaktif.</>,
    });
    if (ok) run(() => deleteDoc(doc(db, 'users', u.id)), 'Akun dihapus.');
  }

  async function handleReset() {
    const ok = await confirm({
      title: 'Reset semua data operasional?', danger: true, confirmLabel: 'Hapus Semua Data', requireText: 'RESET',
      message: <>Seluruh aset, customer, merchant & lokasi, supplier & model, part, kontrak, pengajuan, lampiran, dan riwayat pergerakan akan dihapus <b>permanen</b>. Akun user tidak ikut dihapus. Export data lebih dulu jika masih dibutuhkan.</>,
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

  const copyCredentials = () => {
    if (!created) return;
    const text = `Login Channel Inventory Management\nAlamat: ${window.location.origin}\nUsername: ${created.username}\nPassword sementara: ${created.password}\n(Wajib diganti saat login pertama)`;
    navigator.clipboard.writeText(text).then(() => toast('Info login disalin.'), () => toast('Gagal menyalin, salin manual.', 'error'));
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={ShieldCheck} title="User & Role" subtitle="Akun login dibuat oleh Admin">
        <button onClick={() => setCreateForm(emptyCreate())} className={btnPrimary}><UserPlus size={16} /> Tambah User</button>
      </PageHeader>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted" size={16} />
        <input type="search" aria-label="Cari user" className={cn(inputClass, 'pl-10 bg-white')} placeholder="Cari nama, username, role..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-brand-border overflow-hidden self-start">
          <div className="px-5 py-3 border-b border-brand-border bg-gray-50/50 text-[10px] font-black text-brand-text-muted uppercase tracking-[0.2em]">Akun ({sortedUsers.length})</div>
          {sortedUsers.length === 0 ? <EmptyState icon={Shield} title="Tidak ada akun yang cocok" /> : (
            <ul className="divide-y divide-brand-border">
              {sortedUsers.map(u => {
                const isMe = u.id === me?.uid;
                const legacy = isLegacy(u);
                return (
                  <li key={u.id} className={cn('px-5 py-3 flex flex-wrap items-center gap-3', legacy && 'bg-gray-50/60')}>
                    <div className="w-9 h-9 rounded-lg bg-brand-primary-light text-brand-primary flex items-center justify-center font-black text-sm shrink-0">
                      {(u.displayName || u.username || u.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-brand-text-main truncate">{u.displayName || u.username || '-'} {isMe && <span className="text-[10px] font-black text-brand-primary">(Anda)</span>}</p>
                      <p className="text-xs text-brand-text-muted truncate">{legacy ? u.email : `@${u.username}`}</p>
                      {legacy && <p className="text-[10px] font-bold text-amber-700 mt-0.5">Akun versi lama (login Google), tidak bisa dipakai login lagi. Aman dihapus.</p>}
                      {!legacy && u.mustChangePassword && <p className="text-[10px] font-bold text-sky-700 mt-0.5 flex items-center gap-1"><KeyRound size={10} /> Belum mengganti password sementara</p>}
                    </div>
                    <span className="text-[10px] font-black text-brand-primary bg-brand-primary-light px-2 py-0.5 rounded border border-brand-primary/10 uppercase tracking-wide">{u.role}</span>
                    {u.status === 'Inactive' && <span className="text-[10px] font-black text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200 uppercase">Nonaktif</span>}
                    <div className="flex gap-1.5">
                      {!isMe && !legacy && (
                        <button disabled={busy} onClick={() => { setEditing(u); setEditForm({ displayName: u.displayName || '', role: u.role, status: u.status || 'Active' }); }} aria-label={`Edit ${u.username}`} className="p-1.5 text-brand-text-muted hover:text-brand-primary border border-brand-border rounded"><Edit2 size={14} /></button>
                      )}
                      {!isMe && <button disabled={busy} onClick={() => handleDelete(u)} aria-label={`Hapus ${u.username || u.email}`} className="p-1.5 text-brand-text-muted hover:text-red-600 border border-brand-border rounded"><Trash2 size={14} /></button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 space-y-2 text-[11px] text-blue-900 leading-relaxed">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2"><KeyRound size={14} /> Lupa Password</h3>
            <p>User bisa mengganti password sendiri lewat tombol <b>Ganti Password</b> di sidebar.</p>
            <p>Kalau user lupa password, ubah statusnya menjadi <b>Nonaktif</b> lalu buatkan akun baru dengan username lain. Reset password oleh Admin butuh server terpisah (belum tersedia).</p>
          </div>

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
            <p className="text-[11px] text-red-700 leading-relaxed">Menghapus seluruh data operasional (aset, customer, merchant, supplier, part, kontrak, pengajuan, lampiran, riwayat). Tidak bisa dibatalkan.</p>
            <button disabled={busy} onClick={handleReset} className="w-full py-2.5 bg-red-600 text-white rounded-lg text-[11px] font-black uppercase tracking-widest hover:bg-red-700 disabled:opacity-50">Reset Data Operasional</button>
          </div>
        </div>
      </div>

      <Modal open={!!createForm} onClose={() => setCreateForm(null)} busy={busy} title="Tambah User" subtitle="User wajib mengganti password saat login pertama">
        {createForm && (
          <form onSubmit={handleCreate} className="p-6 space-y-4">
            <Field label="Username" hint="Huruf kecil, angka, titik, minus, atau garis bawah. Tidak bisa diubah setelah dibuat.">
              <input required autoCapitalize="none" spellCheck={false} maxLength={32} className={inputClass} value={createForm.username} onChange={e => setCreateForm({ ...createForm, username: e.target.value.toLowerCase().replace(/\s/g, '') })} />
            </Field>
            <Field label="Nama Lengkap"><input required maxLength={200} className={inputClass} value={createForm.displayName} onChange={e => setCreateForm({ ...createForm, displayName: e.target.value })} /></Field>
            <Field label="Role" hint={ROLE_DESCRIPTIONS[createForm.role as Role]}>
              <select className={inputClass} value={createForm.role} onChange={e => setCreateForm({ ...createForm, role: e.target.value })}>{ROLES.map(r => <option key={r}>{r}</option>)}</select>
            </Field>
            <Field id="temp-password" label="Password Sementara" hint={`Minimal ${MIN_PASSWORD_LENGTH} karakter. Berikan ke user; ia wajib menggantinya saat login pertama.`}>
              <div className="flex gap-2">
                <input id="temp-password" required minLength={MIN_PASSWORD_LENGTH} className={cn(inputClass, 'font-mono')} value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })} />
                <button type="button" onClick={() => setCreateForm({ ...createForm, password: generatePassword() })} aria-label="Buat password acak" title="Buat password acak" className={btnSecondary}><RefreshCw size={14} /></button>
              </div>
            </Field>
            <div className="flex gap-3 pt-2">
              <button type="button" disabled={busy} onClick={() => setCreateForm(null)} className={cn(btnSecondary, 'flex-1 py-3')}>Batal</button>
              <button type="submit" disabled={busy} className={cn(btnPrimary, 'flex-1 py-3')}>{busy ? 'Membuat akun...' : 'Buat Akun'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!created} onClose={() => setCreated(null)} title="Akun berhasil dibuat" subtitle="Password ini hanya ditampilkan sekali" size="sm">
        {created && (
          <div className="p-6 space-y-4">
            <dl className="p-4 bg-gray-50 border border-brand-border rounded-xl space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-brand-text-muted font-bold">Username</dt><dd className="font-mono font-bold text-brand-text-main">{created.username}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-brand-text-muted font-bold">Password sementara</dt><dd className="font-mono font-bold text-brand-text-main">{created.password}</dd></div>
            </dl>
            <p className="text-[11px] text-brand-text-muted">Kirimkan ke user lewat jalur pribadi. Saat login pertama, user wajib membuat password baru.</p>
            <div className="flex gap-3">
              <button onClick={copyCredentials} className={cn(btnSecondary, 'flex-1 py-3')}><Copy size={14} /> Salin Info Login</button>
              <button onClick={() => setCreated(null)} className={cn(btnPrimary, 'flex-1 py-3')}>Selesai</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} busy={busy} title="Ubah Akun" subtitle={editing?.username ? `@${editing.username}` : ''}>
        <form onSubmit={handleEdit} className="p-6 space-y-4">
          <Field label="Nama Lengkap"><input required maxLength={200} className={inputClass} value={editForm.displayName} onChange={e => setEditForm({ ...editForm, displayName: e.target.value })} /></Field>
          <Field label="Role" hint={ROLE_DESCRIPTIONS[editForm.role as Role]}>
            <select className={inputClass} value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })}>
              {!(ROLES as readonly string[]).includes(editForm.role) && <option value={editForm.role}>{editForm.role} (tidak valid)</option>}
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Status" hint="User nonaktif langsung kehilangan akses tanpa menghapus akunnya.">
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
