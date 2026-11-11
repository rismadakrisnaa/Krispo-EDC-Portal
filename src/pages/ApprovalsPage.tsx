import React, { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { CheckCircle2, ClipboardCheck, PlayCircle, Undo2, XCircle } from 'lucide-react';
import { db, describeError } from '../lib/firebase';
import { APPROVAL_STATUS_META, CANCEL_TERMINATION, approvalTypeLabel, statusMeta } from '../lib/constants';
import { approvalTitle, cancelApproval, decideApproval, executeApproval } from '../lib/approvals';
import { fieldLabel } from '../lib/movements';
import { cn, formatDate, formatIDR } from '../lib/utils';
import type { Approval } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useNav } from '../context/NavContext';
import { Attachments } from '../components/Attachments';
import { EmptyState, PageHeader, StatusBadge, btnPrimary, btnSecondary, inputClass, useFeedback } from '../components/ui';

type Tab = 'todo' | 'open' | 'history';

function ApprovalCard({ approval }: { approval: Approval }) {
  const { user, can } = useAuth();
  const data = useData();
  const { go } = useNav();
  const { toast, confirm } = useFeedback();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const isMine = approval.requestedBy === user?.uid;
  const canDecide = can('approvals.decide') && !isMine && approval.status === 'Pending';
  const canExecute = can('movements.create') && approval.status === 'Approved';
  const canCancel = isMine && (approval.status === 'Pending' || approval.status === 'Approved');
  const meta = APPROVAL_STATUS_META[approval.status];
  const r = approval.request || ({} as Approval['request']);
  const details = Object.entries(r.details || {}).filter(([, v]) => v !== '' && v != null && v !== false);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast(success);
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  async function handleExecute() {
    const ok = await confirm({
      title: 'Eksekusi pengajuan?',
      confirmLabel: 'Ya, Eksekusi',
      message: <>{approvalTitle(approval)} akan dijalankan sekarang{approval.type !== CANCEL_TERMINATION ? ' dan Berita Acara diunduh' : ''}. Status unit langsung berubah.</>,
    });
    if (!ok) return;
    run(async () => {
      const result = await executeApproval(approval, {
        childrenOf: data.childrenOf, customerById: data.customerById, approvalByAsset: data.approvalByAsset,
        assetById: data.assetById, locations: data.locations,
      });
      if (result.baNumber) toast(`Berita Acara ${result.baNumber} diunduh.`, 'info');
    }, 'Pengajuan dieksekusi.');
  }

  return (
    <div className="bg-white rounded-xl border border-brand-border p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-brand-text-main">{approvalTitle(approval)}</h3>
          <p className="text-[11px] text-brand-text-muted font-bold mt-0.5">
            Diajukan {approval.requestedByName || '-'} · {formatDate(approval.requestedAt, 'dd MMM yyyy HH:mm')}
            {r.transactionDate && ` · tanggal efektif ${formatDate(r.transactionDate)}`}
          </p>
        </div>
        <span className={cn('px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap', meta?.badge)}>{meta?.label || approval.status}</span>
      </div>

      {approval.summary && <p className="text-sm text-brand-text-main font-medium">{approval.summary}</p>}

      <div className="flex flex-wrap gap-1.5">
        {approval.assetSns.slice(0, 20).map((sn, i) => {
          const asset = data.assetById.get(approval.assetIds[i]);
          return (
            <button
              key={approval.assetIds[i]} onClick={() => go('inventory', { q: sn, status: 'All' })} title={asset ? statusMeta(asset.status).label : 'Unit tidak ditemukan'}
              className="px-2 py-0.5 rounded border border-brand-border bg-gray-50 text-[11px] font-bold text-brand-text-main hover:border-brand-primary"
            >
              {sn}{asset && <span className="ml-1 text-brand-text-muted font-medium">· {statusMeta(asset.status).label}</span>}
            </button>
          );
        })}
        {approval.assetSns.length > 20 && <span className="text-[11px] text-brand-text-muted self-center">+{approval.assetSns.length - 20} unit lain</span>}
      </div>

      {(details.length > 0 || r.notes) && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {details.map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="text-brand-text-muted font-bold shrink-0">{approval.type === CANCEL_TERMINATION ? key : fieldLabel(approval.type as any, key as any)}:</dt>
              <dd className="text-brand-text-main">{value === true ? 'Ya' : typeof value === 'number' ? formatIDR(value) : String(value)}</dd>
            </div>
          ))}
          {r.notes && <div className="sm:col-span-2 flex gap-2"><dt className="text-brand-text-muted font-bold shrink-0">{approval.type === CANCEL_TERMINATION ? 'Alasan' : 'Catatan'}:</dt><dd className="text-brand-text-main">{r.notes}</dd></div>}
        </dl>
      )}

      {approval.decidedByName && (
        <p className={cn('text-xs font-medium px-3 py-2 rounded-lg', approval.status === 'Rejected' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-800')}>
          {approval.status === 'Rejected' ? 'Ditolak' : 'Disetujui'} oleh {approval.decidedByName} · {formatDate(approval.decidedAt, 'dd MMM yyyy HH:mm')}
          {approval.decisionNote && <> · "{approval.decisionNote}"</>}
        </p>
      )}
      {approval.executedByName && (
        <p className="text-xs font-medium px-3 py-2 rounded-lg bg-emerald-50 text-emerald-800">
          Dieksekusi oleh {approval.executedByName} · {formatDate(approval.executedAt, 'dd MMM yyyy HH:mm')}{approval.baNumber && ` · ${approval.baNumber}`}
        </p>
      )}

      <div className="border-t border-brand-border pt-3">
        <Attachments parentType="approval" parentId={approval.id} expanded title="Bukti Pendukung" defaultLabel={approval.type === 'Lost' ? 'Laporan polisi / kehilangan' : 'Memo persetujuan'} />
      </div>

      {(canDecide || canExecute || canCancel) && (
        <div className="border-t border-brand-border pt-3 space-y-3">
          {canDecide && (
            <>
              <textarea aria-label="Catatan keputusan" className={cn(inputClass, 'min-h-[60px]')} maxLength={500} placeholder="Catatan keputusan (wajib jika menolak)" value={note} onChange={e => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => run(() => decideApproval(approval, 'Approved', note), 'Pengajuan disetujui. Operator bisa mengeksekusinya.')} className={btnPrimary}>
                  <CheckCircle2 size={15} /> Setujui
                </button>
                <button disabled={busy} onClick={() => run(() => decideApproval(approval, 'Rejected', note), 'Pengajuan ditolak.')} className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-red-100 disabled:opacity-50">
                  <XCircle size={15} /> Tolak
                </button>
              </div>
            </>
          )}
          {!canDecide && approval.status === 'Pending' && isMine && can('approvals.decide') && (
            <p className="text-[11px] text-brand-text-muted">Pengajuan Anda sendiri harus disetujui Admin / Management lain.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {canExecute && (
              <button disabled={busy} onClick={handleExecute} className={btnPrimary}><PlayCircle size={15} /> Eksekusi Sekarang</button>
            )}
            {canCancel && (
              <button disabled={busy} onClick={() => run(() => cancelApproval(approval), 'Pengajuan dibatalkan.')} className={btnSecondary}><Undo2 size={15} /> Batalkan Pengajuan</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ApprovalsPage() {
  const { openApprovals } = useData();
  const { user, can } = useAuth();
  const { params } = useNav();
  const [tab, setTab] = useState<Tab | null>((['todo', 'open', 'history'] as Tab[]).includes(params.tab as Tab) ? (params.tab as Tab) : null);
  const [history, setHistory] = useState<Approval[] | null>(null);


  // "Perlu tindakan saya": pemeriksa melihat pengajuan orang lain; operator melihat yang siap dieksekusi.
  const todo = useMemo(() => openApprovals.filter(a =>
    (a.status === 'Pending' && can('approvals.decide') && a.requestedBy !== user?.uid) ||
    (a.status === 'Approved' && can('movements.create')),
  ), [openApprovals, can, user]);

  // Tanpa pilihan eksplisit: buka "Perlu Tindakan Saya" jika ada isinya, selain itu "Semua Berjalan".
  const activeTab: Tab = tab ?? (todo.length > 0 ? 'todo' : 'open');
  const list = activeTab === 'todo' ? todo : activeTab === 'open' ? openApprovals : history;

  useEffect(() => {
    if (activeTab !== 'history') return;
    // Tanpa filter status di query supaya tidak butuh composite index; status difilter di client.
    const q = query(collection(db, 'approvals'), orderBy('requestedAt', 'desc'), limit(100));
    return onSnapshot(
      q,
      snap => setHistory(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Approval).filter(a => !['Pending', 'Approved'].includes(a.status))),
      err => { console.error(err); setHistory([]); },
    );
  }, [activeTab]);
  const tabs: [Tab, string][] = [['todo', `Perlu Tindakan Saya (${todo.length})`], ['open', `Semua Berjalan (${openApprovals.length})`], ['history', 'Riwayat']];

  return (
    <div className="space-y-6">
      <PageHeader icon={ClipboardCheck} title="Persetujuan" subtitle="Disposal, kehilangan, retur supplier, dan batal pengakhiran kontrak wajib disetujui orang lain" />

      <div className="flex flex-wrap bg-white rounded-xl border border-brand-border p-1 gap-1 w-fit">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} aria-pressed={activeTab === id} className={cn('px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider', activeTab === id ? 'bg-brand-primary text-white' : 'text-brand-text-muted hover:bg-gray-50')}>
            {label}
          </button>
        ))}
      </div>

      {list === null ? null : list.length === 0 ? (
        <div className="bg-white rounded-xl border border-brand-border">
          <EmptyState icon={ClipboardCheck} title={activeTab === 'todo' ? 'Tidak ada yang perlu Anda tindak lanjuti' : 'Belum ada pengajuan'} hint={`Pengajuan dibuat dari menu Pergerakan EDC (${['Disposal', 'Lost', 'Return to Supplier'].map(approvalTypeLabel).join(', ')}) atau Monitoring Kontrak (batal pengakhiran).`} />
        </div>
      ) : (
        <div className="space-y-4">{list.map(a => <React.Fragment key={a.id}><ApprovalCard approval={a} /></React.Fragment>)}</div>
      )}
    </div>
  );
}
