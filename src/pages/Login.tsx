import React, { useState } from 'react';
import { Package, ShieldCheck } from 'lucide-react';
import { signInWithGoogle } from '../lib/firebase';
import { motion } from 'motion/react';

export function Login() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    setError('');
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      // Popup ditutup user: bukan error.
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
      console.error('Sign-in error:', err);
      setError(
        err.code === 'auth/popup-blocked'
          ? 'Popup login diblokir browser. Izinkan popup untuk situs ini lalu coba lagi.'
          : err.code === 'auth/unauthorized-domain'
            ? `Domain ${window.location.hostname} belum diizinkan. Admin perlu menambahkannya di Firebase Console > Authentication > Settings > Authorized domains.`
            : 'Login gagal. Periksa koneksi internet lalu coba lagi.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-primary rounded-2xl shadow-xl shadow-blue-200 mb-6 transform rotate-3">
            <Package size={32} className="text-white" />
          </div>
          <div className="flex flex-col items-center">
            <div className="text-[10px] font-black text-brand-primary uppercase tracking-[0.4em] mb-1">Channel Inventory</div>
            <h1 className="text-3xl font-extrabold text-brand-text-main tracking-tighter leading-none">MANAGEMENT</h1>
            <div className="text-sm font-light text-brand-text-muted italic opacity-60 mt-2 uppercase tracking-[0.5em]">ARTAJASA</div>
          </div>
          <p className="text-brand-text-muted mt-6 font-medium text-xs italic tracking-wide">Enterprise Warehouse Management</p>
        </div>

        <div className="bg-white p-8 rounded-2xl border border-brand-border shadow-sm">
          <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl mb-8 border border-blue-100">
            <ShieldCheck size={18} className="text-brand-primary shrink-0" />
            <p className="text-[11px] text-blue-800 font-bold uppercase tracking-wider">Akses terbatas • Hanya akun yang diundang Admin</p>
          </div>

          <button
            onClick={handleSignIn}
            disabled={busy}
            className="w-full h-12 bg-brand-text-main text-white rounded-xl flex items-center justify-center gap-3 text-sm font-bold hover:bg-black transition-all active:scale-[0.98] shadow-md shadow-gray-200 disabled:opacity-60"
          >
            {busy ? 'Membuka login Google...' : 'Masuk dengan Google'}
          </button>
          {error && <p role="alert" className="mt-4 text-xs font-medium text-red-600 text-center">{error}</p>}

          <div className="mt-8 text-center pt-6 border-t border-brand-border">
            <p className="text-[9px] text-brand-text-muted uppercase tracking-[0.3em] font-bold">Standard Operating Environment</p>
          </div>
        </div>
      </motion.div>
      
      <footer className="mt-auto pt-10">
        <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.3em] text-center">
          &copy; 2026 Rismada Krisna Anugrah
        </p>
      </footer>
    </div>
  );
}
