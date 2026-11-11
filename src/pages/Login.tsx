import React, { useState } from 'react';
import { Eye, EyeOff, Package, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { describeError, registerOwnAccount, signInWithUsername } from '../lib/firebase';
import { BOOTSTRAP_ADMIN_USERNAME, MIN_PASSWORD_LENGTH } from '../lib/constants';
import { cn } from '../lib/utils';

const input = 'w-full px-4 py-3 bg-gray-50 border border-brand-border rounded-xl text-sm font-medium text-brand-text-main outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary';

export function Login() {
  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const switchMode = (next: 'login' | 'setup') => {
    setMode(next);
    setError('');
    setPassword('');
    setConfirm('');
    setUsername(next === 'setup' ? BOOTSTRAP_ADMIN_USERNAME : '');
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'setup') {
      if (password.length < MIN_PASSWORD_LENGTH) return setError(`Password minimal ${MIN_PASSWORD_LENGTH} karakter.`);
      if (password !== confirm) return setError('Konfirmasi password tidak sama.');
    }
    setBusy(true);
    try {
      if (mode === 'setup') await registerOwnAccount(BOOTSTRAP_ADMIN_USERNAME, password);
      else await signInWithUsername(username, password);
    } catch (err: any) {
      console.error('Login error:', err);
      setError(
        mode === 'setup' && err?.code === 'auth/email-already-in-use'
          ? 'Akun admin sudah pernah dibuat. Silakan login dengan username "admin".'
          : describeError(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-primary rounded-2xl shadow-xl shadow-blue-200 mb-6 transform rotate-3">
            <Package size={32} className="text-white" />
          </div>
          <div className="flex flex-col items-center">
            <div className="text-[10px] font-black text-brand-primary uppercase tracking-[0.4em] mb-1">Channel Inventory</div>
            <h1 className="text-3xl font-extrabold text-brand-text-main tracking-tighter leading-none">MANAGEMENT</h1>
            <div className="text-sm font-light text-brand-text-muted italic opacity-60 mt-2 uppercase tracking-[0.5em]">ARTAJASA</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-2xl border border-brand-border shadow-sm space-y-5">
          <div className="flex items-center gap-3 p-3.5 bg-blue-50 rounded-xl border border-blue-100">
            <ShieldCheck size={18} className="text-brand-primary shrink-0" />
            <p className="text-[11px] text-blue-800 font-bold leading-snug">
              {mode === 'setup'
                ? 'Setup awal: buat password untuk akun admin pertama. Hanya bisa dilakukan sekali.'
                : 'Akses terbatas. Akun dibuat oleh Admin.'}
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="block text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Username</span>
            <input
              className={input} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus={mode === 'login'}
              disabled={mode === 'setup'} value={username} onChange={e => setUsername(e.target.value)}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Password</span>
            <div className="relative">
              <input
                className={cn(input, 'pr-11')} type={showPassword ? 'text' : 'password'} required autoFocus={mode === 'setup'}
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                value={password} onChange={e => setPassword(e.target.value)}
              />
              <button
                type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-brand-text-muted hover:text-brand-text-main"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          {mode === 'setup' && (
            <label className="block space-y-1.5">
              <span className="block text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Ulangi Password</span>
              <input className={input} type={showPassword ? 'text' : 'password'} required autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
            </label>
          )}

          {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}

          <button
            type="submit" disabled={busy}
            className="w-full h-12 bg-brand-text-main text-white rounded-xl text-sm font-bold hover:bg-black transition-all active:scale-[0.98] shadow-md shadow-gray-200 disabled:opacity-60"
          >
            {busy ? 'Memproses...' : mode === 'setup' ? 'Buat Akun Admin' : 'Masuk'}
          </button>

          <div className="pt-4 border-t border-brand-border text-center">
            {mode === 'login' ? (
              <p className="text-[11px] text-brand-text-muted">
                Lupa password? Hubungi Admin.
                <br />
                <button type="button" onClick={() => switchMode('setup')} className="mt-2 font-bold text-brand-primary hover:underline">Setup admin pertama</button>
              </p>
            ) : (
              <button type="button" onClick={() => switchMode('login')} className="text-[11px] font-bold text-brand-primary hover:underline">Kembali ke login</button>
            )}
          </div>
        </form>
      </motion.div>

      <footer className="mt-auto pt-10">
        <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.3em] text-center">&copy; 2026 Rismada Krisna Anugrah</p>
      </footer>
    </div>
  );
}
