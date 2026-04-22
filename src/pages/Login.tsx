import React from 'react';
import { Package, ShieldCheck } from 'lucide-react';
import { signInWithGoogle } from '../lib/firebase';
import { motion } from 'motion/react';

export function Login() {
  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error: any) {
      if (
        error.code === 'auth/popup-closed-by-user' ||
        error.code === 'auth/cancelled-popup-request'
      ) {
        // These are expected when the user cancels or closes the popup
        console.log('Sign-in interaction cancelled by user');
        return;
      }
      console.error('Sign-in error:', error);
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
            <p className="text-[11px] text-blue-800 font-bold uppercase tracking-wider">Restricted Access • SSO Required</p>
          </div>

          <button
            onClick={handleSignIn}
            className="w-full h-12 bg-brand-text-main text-white rounded-xl flex items-center justify-center gap-3 text-sm font-bold hover:bg-black transition-all active:scale-[0.98] shadow-md shadow-gray-200"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/pwa_google_main_logo.png" className="w-5 h-5" alt="Google" />
            Authenticate via Google
          </button>

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
