import React, { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { FileText, Image as ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import { db, describeError } from '../lib/firebase';
import { MAX_ATTACHMENT_BYTES, type AttachmentParent } from '../lib/constants';
import { ATTACHMENT_LABELS, deleteAttachment, formatBytes, openAttachment, uploadAttachments } from '../lib/attachments';
import { cn, formatDate } from '../lib/utils';
import type { Attachment } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { Spinner, inputClass, useFeedback } from './ui';

interface Props {
  parentType: AttachmentParent;
  parentId: string;
  /** Tampilkan langsung (true) atau sebagai tombol "Lampiran" yang bisa dibuka. */
  expanded?: boolean;
  defaultLabel?: string;
  title?: string;
  /** Hint di bawah tombol unggah. */
  hint?: string;
}

/** Daftar & unggah lampiran (foto / PDF) untuk satu transaksi, pengajuan, atau unit. */
export function Attachments({ parentType, parentId, expanded = false, defaultLabel = 'Lainnya', title = 'Lampiran', hint }: Props) {
  const { can, user } = useAuth();
  const { toast, confirm } = useFeedback();
  const [open, setOpen] = useState(expanded);
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [label, setLabel] = useState(defaultLabel);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const q = query(collection(db, 'attachments'), where('parentId', '==', parentId));
    return onSnapshot(
      q,
      snap => setItems(
        snap.docs.map(d => ({ ...d.data(), id: d.id }) as Attachment)
          .filter(a => a.parentType === parentType)
          .sort((a, b) => (a.uploadedAt?.toMillis() || 0) - (b.uploadedAt?.toMillis() || 0)),
      ),
      error => { console.error(error); setItems([]); },
    );
  }, [open, parentId, parentType]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const count = await uploadAttachments(parentType, parentId, Array.from(files), label);
      toast(`${count} lampiran diunggah.`);
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete(att: Attachment) {
    if (!(await confirm({ title: 'Hapus lampiran?', danger: true, confirmLabel: 'Ya, Hapus', message: <>Lampiran <b>{att.name}</b> dihapus permanen.</> }))) return;
    try {
      await deleteAttachment(att);
      toast('Lampiran dihapus.');
    } catch (error) {
      toast(describeError(error), 'error');
    }
  }

  // Pengunggah boleh menghapus lampirannya dalam 24 jam; Admin kapan saja (dijaga juga di rules).
  const canDelete = (att: Attachment) =>
    can('delete') || (att.uploadedBy === user?.uid && Date.now() - (att.uploadedAt?.toMillis() || 0) < 86_400_000);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[10px] font-bold text-brand-text-muted hover:text-brand-primary uppercase">
        <Paperclip size={11} /> {title}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest flex items-center gap-1.5">
        <Paperclip size={11} /> {title} {items && `(${items.length})`}
      </p>
      {items === null ? (
        <div className="text-brand-text-muted"><Spinner /></div>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-brand-text-muted italic">Belum ada lampiran.</p>
      ) : (
        <ul className="space-y-1">
          {items.map(att => (
            <li key={att.id} className="flex items-center gap-2 text-[11px]">
              {att.mimeType.startsWith('image/') ? <ImageIcon size={13} className="text-brand-primary shrink-0" /> : <FileText size={13} className="text-red-500 shrink-0" />}
              <button
                type="button" className="font-bold text-brand-primary hover:underline truncate text-left"
                onClick={() => openAttachment(att).catch(error => toast(describeError(error), 'error'))}
              >
                {att.name}
              </button>
              <span className="text-brand-text-muted shrink-0 truncate">
                {att.label ? `${att.label} · ` : ''}{formatBytes(att.size)} · {att.uploadedByName || '-'} · {formatDate(att.uploadedAt, 'dd MMM yy')}
              </span>
              {canDelete(att) && (
                <button type="button" aria-label={`Hapus ${att.name}`} onClick={() => handleDelete(att)} className="ml-auto p-1 text-gray-400 hover:text-red-600 shrink-0"><Trash2 size={12} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {can('attachments.upload') && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select aria-label="Jenis lampiran" className={cn(inputClass, 'w-auto py-1.5 text-xs')} value={label} onChange={e => setLabel(e.target.value)}>
            {ATTACHMENT_LABELS.map(l => <option key={l}>{l}</option>)}
          </select>
          <label className={cn('px-3 py-1.5 rounded-lg border border-brand-border bg-white text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-gray-50', busy && 'opacity-50 pointer-events-none')}>
            {busy ? <Spinner /> : <Upload size={13} />} {busy ? 'Mengunggah...' : 'Unggah'}
            <input
              ref={inputRef} type="file" multiple accept="image/*,application/pdf" capture={undefined} className="hidden"
              aria-label={`Unggah ${title}`} disabled={busy} onChange={e => handleFiles(e.target.files)}
            />
          </label>
          <span className="text-[10px] text-brand-text-muted">{hint || `Foto otomatis dikompres. PDF maks ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB.`}</span>
        </div>
      )}
    </div>
  );
}
