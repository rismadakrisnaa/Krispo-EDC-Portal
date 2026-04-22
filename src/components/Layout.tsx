import React, { useState } from 'react';
import { 
  BarChart3, 
  Package, 
  Users, 
  FileText, 
  ArrowLeftRight, 
  LayoutDashboard, 
  LogOut,
  ChevronRight,
  UserCircle,
  MapPin,
  ChevronDown,
  Database,
  Smartphone,
  ShieldAlert,
  Settings
} from 'lucide-react';
import { logout } from '../lib/firebase';
import { cn } from '../lib/utils';
import { type Page } from '../App';
import { type User } from 'firebase/auth';

interface LayoutProps {
  children: React.ReactNode;
  user: User;
  role: string | null;
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export function Layout({ children, user, role, currentPage, onNavigate }: LayoutProps) {
  const [masterDataOpen, setMasterDataOpen] = useState(
    ['customers', 'locations', 'parts'].includes(currentPage)
  );

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { 
      id: 'master-data', 
      label: 'Master Data', 
      icon: Database,
      isParent: true,
      open: masterDataOpen,
      setOpen: setMasterDataOpen,
      subItems: [
        { id: 'customers', label: 'Master B2B Customers', icon: Users },
        { id: 'locations', label: 'Master Lokasi', icon: MapPin },
        { id: 'parts', label: 'Master Part EDC', icon: Settings },
      ]
    },
    { id: 'movements', label: 'Pergerakan EDC', icon: ArrowLeftRight },
    { id: 'contracts', label: 'Monitoring Kontrak', icon: ShieldAlert },
    { id: 'inventory', label: 'Master dan Monitoring Aset', icon: Smartphone },
    { id: 'users', label: 'User & Role', icon: UserCircle },
  ];

  return (
    <div className="flex h-screen bg-brand-bg overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-[260px] bg-brand-sidebar border-r border-brand-border flex flex-col shrink-0 py-6">
        <div className="px-6 mb-8">
          <div className="flex flex-col">
            <div className="text-[9px] font-black text-brand-primary uppercase tracking-[0.2em] opacity-80">Channel Inventory</div>
            <div className="text-lg font-extrabold text-brand-text-main tracking-tighter leading-none mt-0.5">MANAGEMENT</div>
            <div className="text-[10px] font-light text-brand-primary italic opacity-60 mt-1 uppercase tracking-[0.3em]">ARTAJASA</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {menuItems.map((item) => (
            <div key={item.id} className="space-y-1">
              {item.isParent ? (
                <>
                  <button
                    onClick={() => item.setOpen(!item.open)}
                    className={cn(
                      "w-full flex items-center justify-between px-4 py-2.5 transition-all duration-200 group text-sm font-semibold rounded-lg text-left leading-tight",
                      item.subItems?.some(s => s.id === currentPage)
                        ? "text-brand-primary bg-brand-primary-light/30" 
                        : "text-brand-text-muted hover:bg-gray-100/80 hover:text-brand-text-main"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon size={18} className={cn(
                        "shrink-0 transition-colors",
                        item.subItems?.some(s => s.id === currentPage) ? "text-brand-primary" : "text-gray-400 group-hover:text-gray-600"
                      )} />
                      <span>{item.label}</span>
                    </div>
                    {item.open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                  </button>
                  
                  {item.open && (
                    <div className="ml-4 pl-3 border-l border-brand-border/60 space-y-1 mt-1">
                      {item.subItems?.map((sub) => (
                        <button
                          key={sub.id}
                          onClick={() => onNavigate(sub.id as Page)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2 transition-all duration-200 group text-[13px] font-medium rounded-lg text-left leading-tight",
                            currentPage === sub.id 
                              ? "bg-brand-primary text-white shadow-sm shadow-blue-100" 
                              : "text-brand-text-muted hover:bg-gray-50 hover:text-brand-text-main"
                          )}
                        >
                          <sub.icon size={14} className={cn(
                            "shrink-0 transition-colors",
                            currentPage === sub.id ? "text-white" : "text-gray-400 group-hover:text-gray-600"
                          )} />
                          <span>{sub.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={() => onNavigate(item.id as Page)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 transition-all duration-200 group text-sm font-semibold rounded-lg text-left leading-tight",
                    currentPage === item.id 
                      ? "bg-brand-primary text-white shadow-md shadow-blue-100" 
                      : "text-brand-text-muted hover:bg-gray-100/80 hover:text-brand-text-main"
                  )}
                >
                  <item.icon size={18} className={cn(
                    "shrink-0 transition-colors",
                    currentPage === item.id ? "text-white" : "text-gray-400 group-hover:text-gray-600"
                  )} />
                  <span className="truncate lg:whitespace-normal">
                    {item.label}
                  </span>
                </button>
              )}
            </div>
          ))}
        </nav>

        <div className="px-6 pt-6 mt-auto border-t border-brand-border">
          <div className="flex items-center gap-3 mb-6">
            <img 
              src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
              alt="Avatar" 
              className="w-10 h-10 rounded-xl bg-gray-100 border border-brand-border shadow-sm object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand-text-main truncate">{user.displayName}</p>
              <p className="text-[10px] font-black text-brand-primary uppercase tracking-widest">{role}</p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center gap-3 py-3 px-4 bg-red-50 text-red-600 rounded-xl text-xs font-black uppercase tracking-[0.2em] hover:bg-red-600 hover:text-white transition-all group shadow-sm shadow-red-50"
          >
            <LogOut size={16} className="group-hover:rotate-12 transition-transform" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative p-6 flex flex-col gap-5">
        <div className="max-w-7xl mx-auto w-full flex-1">
          {children}
        </div>
        
        <footer className="max-w-7xl mx-auto w-full pt-8 pb-4 border-t border-brand-border/30 mt-auto">
          <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.3em] text-center">
            &copy; 2026 Rismada Krisna Anugrah
          </p>
        </footer>
      </main>
    </div>
  );
}

