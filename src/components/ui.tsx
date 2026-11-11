import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, RefreshCw, X, XCircle } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { cn } from '../lib/utils';
import { statusMeta } from '../lib/constants';

// ---------------------------------------------------------------------------
// Class helper form (satu gaya untuk semua halaman)
// ---------------------------------------------------------------------------
export const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium text-brand-text-main outline-none focus:ring-1 focus:ring-brand-primary disabled:opacity-60 disabled:bg-gray-100';
export const btnPrimary =
  'px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-bold hover:bg-brand-primary-dark transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed';
export const btnSecondary =
  'px-4 py-2 bg-white border border-brand-border text-brand-text-main rounded-lg text-sm font-bold hover:bg-gray-50 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed';
export const btnDanger =
  'px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-lg text-sm font-bold hover:bg-red-100 transition-all flex items-center justify-center gap-2 disabled:opacity-50';

const FORM_CONTROLS = new Set(['input', 'select', 'textarea']);

export function Field({ label, hint, className, id: givenId, children }: { label: string; hint?: string; className?: string; id?: string; children: React.ReactNode }) {
  // Label dihubungkan ke input lewat id (bukan dibungkus), supaya nama aksesibel field
  // hanya teks labelnya, tidak tercampur isi <select> atau teks bantuan.
  // Jika input dibungkus elemen lain, berikan `id` yang sama ke Field dan ke input-nya.
  const autoId = useId();
  const id = givenId || autoId;
  let linked = !!givenId;
  const content = React.Children.map(children, child => {
    if (linked || !React.isValidElement<{ id?: string }>(child) || !FORM_CONTROLS.has(child.type as string)) return child;
    linked = true;
    return child.props.id ? child : React.cloneElement(child, { id });
  });
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">{label}</label>
      {content}
      {hint && <p className="text-[10px] text-brand-text-muted px-1 leading-snug">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Kunci modal saat proses berjalan supaya tidak tertutup tanpa sengaja. */
  busy?: boolean;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}

const MODAL_SIZE = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export function Modal({ open, onClose, title, subtitle, size = 'md', busy, headerExtra, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => !busy && onClose()}
            className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }}
            className={cn('relative w-full bg-white rounded-2xl shadow-2xl border border-brand-border flex flex-col max-h-[90vh]', MODAL_SIZE[size])}
          >
            <div className="px-6 py-4 border-b border-brand-border bg-gray-50/60 flex items-center justify-between gap-4 rounded-t-2xl">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-brand-text-main truncate">{title}</h2>
                {subtitle && <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-widest mt-0.5 truncate">{subtitle}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {headerExtra}
                <button type="button" disabled={busy} onClick={onClose} aria-label="Tutup" className="p-2 text-brand-text-muted hover:text-red-500 transition-colors disabled:opacity-40">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Toast + Confirm (pengganti alert() / confirm() bawaan browser)
// ---------------------------------------------------------------------------
type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; message: string }
interface ConfirmOptions {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Jika diisi, user harus mengetik teks ini untuk melanjutkan. */
  requireText?: string;
}

interface FeedbackApi {
  toast: (message: string, kind?: ToastKind) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi>({ toast: () => {}, confirm: async () => false });
export const useFeedback = () => useContext(FeedbackContext);

const TOAST_STYLE: Record<ToastKind, { icon: React.ElementType; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'border-emerald-200 text-emerald-800 bg-emerald-50' },
  error: { icon: XCircle, cls: 'border-red-200 text-red-800 bg-red-50' },
  info: { icon: Info, cls: 'border-blue-200 text-blue-800 bg-blue-50' },
};

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts(list => list.filter(t => t.id !== id)), []);

  // Notifikasi milik satu sesi tidak boleh terlihat oleh akun berikutnya.
  useEffect(() => {
    let lastUid: string | null | undefined;
    return onAuthStateChanged(auth, user => {
      const uid = user?.uid ?? null;
      if (lastUid !== undefined && uid !== lastUid) setToasts([]);
      lastUid = uid;
    });
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = nextId.current++;
    setToasts(list => [...list.slice(-3), { id, kind, message }]);
    window.setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4500);
  }, [dismiss]);

  const confirm = useCallback((options: ConfirmOptions) => {
    setTyped('');
    setPending(options);
    return new Promise<boolean>(resolve => { resolver.current = resolve; });
  }, []);

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPending(null);
  };

  const blocked = !!pending?.requireText && typed.trim() !== pending.requireText;

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      <Modal open={!!pending} onClose={() => settle(false)} title={pending?.title || ''} size="sm">
        {pending && (
          <div className="p-6 space-y-5">
            <div className="flex gap-3 items-start">
              <div className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0', pending.danger ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-brand-primary')}>
                <AlertTriangle size={20} />
              </div>
              <div className="text-sm text-brand-text-muted leading-relaxed">{pending.message}</div>
            </div>
            {pending.requireText && (
              <Field label={`Ketik "${pending.requireText}" untuk melanjutkan`}>
                <input autoFocus className={inputClass} value={typed} onChange={e => setTyped(e.target.value)} />
              </Field>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => settle(false)} className={cn(btnSecondary, 'flex-1')}>Batal</button>
              <button
                type="button" disabled={blocked} onClick={() => settle(true)}
                className={cn('flex-1', pending.danger ? 'px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-40' : btnPrimary)}
              >
                {pending.confirmLabel || 'Ya, Lanjutkan'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(92vw,380px)]" aria-live="polite">
        <AnimatePresence>
          {toasts.map(t => {
            const { icon: Icon, cls } = TOAST_STYLE[t.kind];
            return (
              <motion.div
                key={t.id} layout
                initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
                className={cn('flex items-start gap-3 p-3.5 rounded-xl border shadow-lg text-sm font-medium', cls)}
              >
                <Icon size={18} className="shrink-0 mt-0.5" />
                <span className="flex-1 whitespace-pre-line leading-snug">{t.message}</span>
                <button onClick={() => dismiss(t.id)} aria-label="Tutup notifikasi" className="opacity-60 hover:opacity-100"><X size={14} /></button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </FeedbackContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Komponen kecil
// ---------------------------------------------------------------------------
export function StatusBadge({ status, className }: { status?: string; className?: string }) {
  const meta = statusMeta(status);
  return (
    <span title={status} className={cn('px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tight border whitespace-nowrap inline-block', meta.badge, className)}>
      {meta.label}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, hint, action }: { icon: React.ElementType; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <Icon size={44} className="text-brand-text-muted opacity-25 mb-3" />
      <p className="text-sm font-bold text-brand-text-muted">{title}</p>
      {hint && <p className="text-xs text-brand-text-muted/80 mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <RefreshCw size={16} className={cn('animate-spin', className)} />;
}

export function PageHeader({ icon: Icon, title, subtitle, children }: { icon: React.ElementType; title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-text-main tracking-tight flex items-center gap-3">
          <Icon className="text-brand-primary shrink-0" />
          {title}
        </h1>
        {subtitle && <p className="text-xs text-brand-text-muted font-bold uppercase tracking-widest mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-brand-border text-xs text-brand-text-muted font-bold">
      <span>{from}-{to} dari {total}</span>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Halaman sebelumnya" className="p-1.5 border border-brand-border rounded-lg disabled:opacity-30 hover:bg-gray-50"><ChevronLeft size={14} /></button>
        <span>Hal {page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Halaman berikutnya" className="p-1.5 border border-brand-border rounded-lg disabled:opacity-30 hover:bg-gray-50"><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

/** Upload zone untuk import Excel. Input di-reset setelah dipilih supaya file yang sama bisa dipilih ulang. */
export function FileDrop({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  return (
    <label className="block p-8 border-2 border-dashed border-brand-border rounded-xl hover:border-brand-primary transition-colors cursor-pointer text-center bg-gray-50/50">
      <input
        type="file" accept=".xlsx,.xls" className="hidden" disabled={busy}
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      <p className="text-sm font-bold text-brand-text-main flex items-center justify-center gap-2">
        {busy && <Spinner />}
        {busy ? 'Memproses file...' : 'Pilih File Excel'}
      </p>
      <p className="text-[10px] text-brand-text-muted uppercase tracking-widest mt-1">Format: .xlsx / .xls</p>
    </label>
  );
}
