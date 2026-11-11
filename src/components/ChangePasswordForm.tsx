import React, { useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Eye, EyeOff } from 'lucide-react';
import { auth, changeOwnPassword, db, describeError } from '../lib/firebase';
import { MIN_PASSWORD_LENGTH } from '../lib/constants';
import { cn } from '../lib/utils';
import { Field, btnPrimary, btnSecondary, inputClass } from './ui';

/** Form ganti password sendiri. Dipakai di login pertama (wajib) dan dari menu akun. */
export function ChangePasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < MIN_PASSWORD_LENGTH) return setError(`Password baru minimal ${MIN_PASSWORD_LENGTH} karakter.`);
    if (next !== confirm) return setError('Konfirmasi password baru tidak sama.');
    if (next === current) return setError('Password baru harus berbeda dari password lama.');
    setBusy(true);
    try {
      await changeOwnPassword(current, next);
      const uid = auth.currentUser?.uid;
      if (uid) await updateDoc(doc(db, 'users', uid), { mustChangePassword: false, updatedAt: serverTimestamp() });
      onDone();
    } catch (err) {
      console.error(err);
      const code = (err as any)?.code;
      setError(code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? 'Password lama salah.' : describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const type = show ? 'text' : 'password';
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Password Lama / Sementara">
        <input type={type} required autoComplete="current-password" className={inputClass} value={current} onChange={e => setCurrent(e.target.value)} />
      </Field>
      <Field label="Password Baru" hint={`Minimal ${MIN_PASSWORD_LENGTH} karakter.`}>
        <input type={type} required autoComplete="new-password" className={inputClass} value={next} onChange={e => setNext(e.target.value)} />
      </Field>
      <Field label="Ulangi Password Baru">
        <input type={type} required autoComplete="new-password" className={inputClass} value={confirm} onChange={e => setConfirm(e.target.value)} />
      </Field>
      <button type="button" onClick={() => setShow(v => !v)} className="flex items-center gap-1.5 text-[11px] font-bold text-brand-text-muted hover:text-brand-text-main">
        {show ? <EyeOff size={14} /> : <Eye size={14} />} {show ? 'Sembunyikan' : 'Tampilkan'} password
      </button>
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
      <div className="flex gap-3 pt-1">
        {onCancel && <button type="button" disabled={busy} onClick={onCancel} className={cn(btnSecondary, 'flex-1 py-3')}>Batal</button>}
        <button type="submit" disabled={busy} className={cn(btnPrimary, 'flex-1 py-3')}>{busy ? 'Menyimpan...' : 'Simpan Password'}</button>
      </div>
    </form>
  );
}
