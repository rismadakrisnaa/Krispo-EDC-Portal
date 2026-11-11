import React, { lazy, Suspense } from 'react';
import { Loader2, ShieldOff } from 'lucide-react';
import { logout } from './lib/firebase';
import { usernameFromEmail } from './lib/constants';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider, useData } from './context/DataContext';
import { NavProvider, useNav } from './context/NavContext';
import { FeedbackProvider } from './components/ui';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { ChangePasswordForm } from './components/ChangePasswordForm';

// Tiap halaman di-load saat dibuka saja, supaya bundle awal kecil.
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const EDCList = lazy(() => import('./pages/EDCList').then(m => ({ default: m.EDCList })));
const MovementPage = lazy(() => import('./pages/MovementPage').then(m => ({ default: m.MovementPage })));
const ContractList = lazy(() => import('./pages/ContractList').then(m => ({ default: m.ContractList })));
const CustomerList = lazy(() => import('./pages/CustomerList').then(m => ({ default: m.CustomerList })));
const LocationList = lazy(() => import('./pages/LocationList').then(m => ({ default: m.LocationList })));
const MasterParts = lazy(() => import('./pages/MasterParts').then(m => ({ default: m.MasterParts })));
const UserManagement = lazy(() => import('./pages/UserManagement').then(m => ({ default: m.UserManagement })));

function FullScreenLoader() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-brand-bg">
      <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
    </div>
  );
}

function AccessMessage({ title, message, detail }: { title: string; message: string; detail?: string | null }) {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl border border-brand-border shadow-sm text-center">
        <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <ShieldOff size={28} />
        </div>
        <h1 className="text-lg font-bold text-brand-text-main mb-2">{title}</h1>
        <p className="text-sm text-brand-text-muted leading-relaxed mb-1">{message}</p>
        {user?.email && <p className="text-xs font-bold text-brand-text-main">{usernameFromEmail(user.email)}</p>}
        {detail && <p className="mt-3 text-[11px] font-mono text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 break-all">{detail}</p>}
        <div className="mb-6" />
        <button onClick={logout} className="w-full py-3 bg-brand-text-main text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black transition-all">
          Keluar
        </button>
      </div>
    </div>
  );
}

function CurrentPage() {
  const { page } = useNav();
  const { can } = useAuth();
  const { loading, error } = useData();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-7 h-7 animate-spin text-brand-primary" />
      </div>
    );
  }

  const content = (() => {
    switch (page) {
      case 'inventory': return <EDCList />;
      case 'movements': return <MovementPage />;
      case 'contracts': return <ContractList />;
      case 'customers': return <CustomerList />;
      case 'locations': return <LocationList />;
      case 'parts': return <MasterParts />;
      case 'users': return can('users.manage') ? <UserManagement /> : <Dashboard />;
      default: return <Dashboard />;
    }
  })();

  return (
    <>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-medium">{error}</div>}
      {content}
    </>
  );
}

function ForcePasswordChange() {
  const { profile } = useAuth();
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl border border-brand-border shadow-sm space-y-5">
        <div>
          <h1 className="text-lg font-bold text-brand-text-main">Ganti Password</h1>
          <p className="text-sm text-brand-text-muted mt-1">
            Halo {profile?.displayName || profile?.username}, akun Anda masih memakai password sementara dari Admin. Buat password baru sebelum melanjutkan.
          </p>
        </div>
        {/* Profil live dari AuthContext otomatis membuka aplikasi setelah tersimpan. */}
        <ChangePasswordForm onDone={() => {}} />
        <button onClick={logout} className="w-full text-[11px] font-bold text-brand-text-muted hover:text-red-600">Keluar</button>
      </div>
    </div>
  );
}

function Shell() {
  const { state, profile, errorCode } = useAuth();

  if (state === 'loading') return <FullScreenLoader />;
  if (state === 'signed-out') return <Login />;
  if (state === 'no-access') {
    return <AccessMessage title="Akun belum terdaftar" message="Login berhasil, tetapi akun ini belum diberi akses. Minta Admin membuatkan akun Anda di menu User & Role." />;
  }
  if (state === 'inactive') {
    return <AccessMessage title="Akun dinonaktifkan" message="Akses akun ini sudah dinonaktifkan oleh Admin." />;
  }
  if (state === 'error') {
    const rulesProblem = errorCode?.includes('permission-denied');
    return (
      <AccessMessage
        title="Gagal memuat akses"
        message={rulesProblem
          ? 'Database menolak akses. Biasanya karena aturan keamanan Firestore versi terbaru belum dipasang. Admin perlu memasang isi file firestore.rules (lihat README, bagian "Deploy security rules").'
          : 'Terjadi masalah saat memeriksa hak akses. Periksa koneksi internet lalu coba login ulang.'}
        detail={errorCode}
      />
    );
  }

  if (profile?.mustChangePassword) return <ForcePasswordChange />;

  return (
    <DataProvider>
      <NavProvider>
        <Layout>
          <Suspense fallback={<div className="flex items-center justify-center py-32"><Loader2 className="w-7 h-7 animate-spin text-brand-primary" /></div>}>
            <CurrentPage />
          </Suspense>
        </Layout>
      </NavProvider>
    </DataProvider>
  );
}

export default function App() {
  return (
    <FeedbackProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </FeedbackProvider>
  );
}
