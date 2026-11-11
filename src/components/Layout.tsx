import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight, ChevronDown, ChevronRight, Database, KeyRound, LayoutDashboard, LogOut, MapPin, Menu,
  Settings, ShieldAlert, Smartphone, UserCircle, Users, X,
} from 'lucide-react';
import { logout } from '../lib/firebase';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { useNav, type Page } from '../context/NavContext';
import { usernameFromEmail } from '../lib/constants';
import { ChangePasswordForm } from './ChangePasswordForm';
import { Modal, useFeedback } from './ui';

interface MenuItem {
  id: Page;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

// Urutan menu mengikuti alur kerja: pantau -> aset -> pergerakan -> kontrak -> master -> admin.
const MAIN_MENU: MenuItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'inventory', label: 'Aset & Monitoring', icon: Smartphone },
  { id: 'movements', label: 'Pergerakan EDC', icon: ArrowLeftRight },
  { id: 'contracts', label: 'Monitoring Kontrak', icon: ShieldAlert },
];

const MASTER_MENU: MenuItem[] = [
  { id: 'customers', label: 'Customer B2B', icon: Users },
  { id: 'locations', label: 'Lokasi', icon: MapPin },
  { id: 'parts', label: 'Part EDC', icon: Settings },
];

const ADMIN_MENU: MenuItem[] = [{ id: 'users', label: 'User & Role', icon: UserCircle, adminOnly: true }];

const itemClass = (active: boolean) =>
  cn(
    'w-full flex items-center gap-3 px-4 py-2.5 transition-all duration-200 group text-sm font-semibold rounded-lg text-left leading-tight',
    active ? 'bg-brand-primary text-white shadow-md shadow-blue-100' : 'text-brand-text-muted hover:bg-gray-100/80 hover:text-brand-text-main',
  );

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, profile, role, can } = useAuth();
  const { page, go } = useNav();
  const isMasterPage = MASTER_MENU.some(m => m.id === page);
  const [masterOpen, setMasterOpen] = useState(isMasterPage);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useFeedback();

  useEffect(() => {
    if (isMasterPage) setMasterOpen(true);
    setDrawerOpen(false);
  }, [page, isMasterPage]);

  const username = profile?.username || usernameFromEmail(user?.email);
  const displayName = profile?.displayName || username || 'User';
  const initials = displayName.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  const renderItem = (item: MenuItem, nested = false) => (
    <button
      key={item.id}
      onClick={() => go(item.id)}
      aria-current={page === item.id ? 'page' : undefined}
      className={cn(itemClass(page === item.id), nested && 'text-[13px] font-medium py-2')}
    >
      <item.icon size={nested ? 14 : 18} className={cn('shrink-0', page === item.id ? 'text-white' : 'text-gray-400 group-hover:text-gray-600')} />
      <span>{item.label}</span>
    </button>
  );

  const sidebar = (
    <>
      <div className="px-6 mb-8 flex items-start justify-between">
        <div className="flex flex-col">
          <div className="text-[9px] font-black text-brand-primary uppercase tracking-[0.2em] opacity-80">Channel Inventory</div>
          <div className="text-lg font-extrabold text-brand-text-main tracking-tighter leading-none mt-0.5">MANAGEMENT</div>
          <div className="text-[10px] font-light text-brand-primary italic opacity-60 mt-1 uppercase tracking-[0.3em]">ARTAJASA</div>
        </div>
        <button className="lg:hidden p-1 text-brand-text-muted" onClick={() => setDrawerOpen(false)} aria-label="Tutup menu"><X size={20} /></button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {MAIN_MENU.map(item => renderItem(item))}

        <button
          onClick={() => setMasterOpen(open => !open)}
          aria-expanded={masterOpen}
          className={cn(
            'w-full flex items-center justify-between px-4 py-2.5 transition-all text-sm font-semibold rounded-lg text-left',
            isMasterPage ? 'text-brand-primary bg-brand-primary-light/30' : 'text-brand-text-muted hover:bg-gray-100/80 hover:text-brand-text-main',
          )}
        >
          <span className="flex items-center gap-3">
            <Database size={18} className={isMasterPage ? 'text-brand-primary' : 'text-gray-400'} />
            Master Data
          </span>
          {masterOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {masterOpen && (
          <div className="ml-4 pl-3 border-l border-brand-border/60 space-y-1">
            {MASTER_MENU.map(item => renderItem(item, true))}
          </div>
        )}

        {can('users.manage') && (
          <div className="pt-3 mt-3 border-t border-brand-border/60 space-y-1">
            {ADMIN_MENU.map(item => renderItem(item))}
          </div>
        )}
      </nav>

      <div className="px-6 pt-5 mt-auto border-t border-brand-border">
        <div className="flex items-center gap-3 mb-4">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" className="w-10 h-10 rounded-xl border border-brand-border object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-brand-primary text-white flex items-center justify-center text-sm font-black">{initials}</div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-brand-text-main truncate">{displayName}</p>
            <p className="text-[10px] font-bold text-brand-text-muted truncate">@{username} · <span className="font-black text-brand-primary uppercase tracking-widest">{role}</span></p>
          </div>
        </div>
        <button
          onClick={() => { setDrawerOpen(false); setShowPassword(true); }}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 mb-2 bg-gray-50 text-brand-text-muted border border-brand-border rounded-xl text-[11px] font-bold hover:text-brand-text-main hover:bg-gray-100 transition-all"
        >
          <KeyRound size={14} />
          Ganti Password
        </button>
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-red-50 text-red-600 rounded-xl text-xs font-black uppercase tracking-[0.15em] hover:bg-red-600 hover:text-white transition-all"
        >
          <LogOut size={16} />
          Keluar
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-brand-bg overflow-hidden font-sans">
      <aside className="hidden lg:flex w-[260px] bg-brand-sidebar border-r border-brand-border flex-col shrink-0 py-6">{sidebar}</aside>

      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-gray-900/40" onClick={() => setDrawerOpen(false)} />
          <aside className="relative w-[270px] max-w-[85vw] bg-brand-sidebar flex flex-col py-6 shadow-2xl">{sidebar}</aside>
        </div>
      )}

      <Modal open={showPassword} onClose={() => setShowPassword(false)} title="Ganti Password" subtitle={`@${username}`} size="sm">
        <div className="p-6">
          <ChangePasswordForm onCancel={() => setShowPassword(false)} onDone={() => { setShowPassword(false); toast('Password berhasil diganti.'); }} />
        </div>
      </Modal>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-brand-border">
          <button onClick={() => setDrawerOpen(true)} aria-label="Buka menu" className="p-1.5 text-brand-text-main"><Menu size={22} /></button>
          <span className="text-sm font-extrabold text-brand-text-main tracking-tight">CIM ARTAJASA</span>
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-5">
          <div className="max-w-7xl mx-auto w-full flex-1">{children}</div>
          <footer className="max-w-7xl mx-auto w-full pt-6 pb-2 border-t border-brand-border/30">
            <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.3em] text-center">
              &copy; 2026 Rismada Krisna Anugrah
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
