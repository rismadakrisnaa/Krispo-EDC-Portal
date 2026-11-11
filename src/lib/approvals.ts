import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { actorName, auth, db } from './firebase';
import {
  APPROVAL_STATUS, CANCEL_TERMINATION, CONTRACT_STATUS, MAX_APPROVAL_UNITS, STATUS, approvalTypeLabel, movementRule, statusMeta,
} from './constants';
import {
  cancelTermination, checkEligibility, endsContract, executeMovement, missingDetails, terminationFor, withdrawalDateProblem,
  type MovementDetails, type MovementResult,
} from './movements';
import { formatIDR, stripUndefined } from './utils';
import type { Approval, Asset, Customer, Location } from './types';

/**
 * Maker-checker: pergerakan berisiko (disposal, hilang, retur supplier, batal pengakhiran)
 * diajukan oleh satu orang, disetujui orang lain, lalu dieksekusi.
 * firestore.rules menolak perubahan status terkait tanpa pengajuan yang sudah disetujui.
 */

interface Lookup {
  childrenOf: (deviceId: string) => Asset[];
  customerById: Map<string, Customer>;
  approvalByAsset: Map<string, Approval>;
}

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi login berakhir. Silakan login ulang.');
  return user;
}

export interface MovementApprovalInput {
  type: string;
  toStatus: string;
  assets: Asset[];
  customer: Customer | null;
  location: Location | null;
  transactionDate: string;
  notes: string;
  picName: string;
  technicianName: string;
  details: MovementDetails;
}

/** Ringkasan & estimasi denda supaya pemeriksa tahu dampak pengajuannya. */
function describe(input: MovementApprovalInput, lookup: Lookup) {
  const rule = movementRule(input.type)!;
  const txDate = new Date(input.transactionDate);
  let penalty = 0;
  let contracts = 0;
  for (const asset of input.assets) {
    if (!endsContract(rule, asset)) continue;
    contracts++;
    const holder = asset.currentCustomerId ? lookup.customerById.get(asset.currentCustomerId) : undefined;
    penalty += terminationFor(asset, holder, txDate)?.penaltyAmount || 0;
  }
  const parts = [`${input.assets.length} unit → ${statusMeta(input.toStatus).label}`];
  if (contracts) parts.push(`${contracts} kontrak aktif diakhiri, estimasi denda ${formatIDR(penalty)}`);
  const d = input.details;
  if (d.referenceNo) parts.push(`Ref ${d.referenceNo}`);
  if (d.disposalMethod) parts.push(`Metode ${d.disposalMethod}`);
  if (d.disposalValue) parts.push(`Nilai ${formatIDR(d.disposalValue)}`);
  const book = input.assets.reduce((sum, a) => sum + (Number(a.purchasePrice) || 0), 0);
  if (rule.type === 'Disposal' && book) parts.push(`Total harga beli ${formatIDR(book)}`);
  return { summary: parts.join(' · '), estimatedPenalty: penalty };
}

export async function requestMovementApproval(input: MovementApprovalInput, lookup: Lookup): Promise<string> {
  const user = requireUser();
  const rule = movementRule(input.type);
  if (!rule?.requiresApproval) throw new Error('Pergerakan ini tidak memerlukan persetujuan.');
  if (input.assets.length === 0) throw new Error('Belum ada unit yang dipilih.');
  if (input.assets.length > MAX_APPROVAL_UNITS) throw new Error(`Maksimal ${MAX_APPROVAL_UNITS} unit per pengajuan. Pecah menjadi beberapa pengajuan.`);
  const { blocked } = checkEligibility(rule, input.assets, lookup.approvalByAsset);
  if (blocked.length) throw new Error(`${blocked.length} unit tidak bisa diajukan: ${blocked[0].asset.sn} (${blocked[0].reason}).`);
  const missing = missingDetails(rule, input.details);
  if (missing.length) throw new Error(`Wajib diisi: ${missing.join(', ')}.`);
  if (!input.transactionDate || input.transactionDate > new Date().toISOString().slice(0, 10)) throw new Error('Tanggal transaksi tidak valid.');
  if (rule.terminatesContract) {
    const problem = withdrawalDateProblem(input.assets.filter(a => endsContract(rule, a)), input.transactionDate);
    if (problem) throw new Error(problem);
  }

  const { summary, estimatedPenalty } = describe(input, lookup);
  const ref = await addDoc(collection(db, 'approvals'), stripUndefined({
    type: input.type,
    assetIds: input.assets.map(a => a.id),
    assetSns: input.assets.map(a => a.sn),
    request: stripUndefined({
      toStatus: input.toStatus,
      customerId: input.customer?.id ?? null,
      locationId: input.location?.id ?? null,
      transactionDate: input.transactionDate,
      notes: input.notes.trim(),
      picName: input.picName.trim(),
      technicianName: input.technicianName.trim(),
      details: stripUndefined({ ...input.details }),
    }),
    summary,
    estimatedPenalty,
    status: APPROVAL_STATUS.PENDING,
    requestedBy: user.uid,
    requestedByName: actorName(),
    requestedAt: serverTimestamp(),
  }));
  return ref.id;
}

export async function requestCancelTermination(assets: Asset[], reason: string, lookup: Lookup): Promise<string> {
  const user = requireUser();
  if (assets.length === 0) throw new Error('Belum ada unit yang dipilih.');
  if (assets.length > MAX_APPROVAL_UNITS) throw new Error(`Maksimal ${MAX_APPROVAL_UNITS} unit per pengajuan.`);
  const locked = assets.find(a => lookup.approvalByAsset.has(a.id));
  if (locked) throw new Error(`Unit ${locked.sn} sudah ada dalam pengajuan lain.`);
  const invalid = assets.find(a => !a.contractStatus || a.contractStatus === CONTRACT_STATUS.ACTIVE || a.status !== STATUS.WITHDRAWN);
  if (invalid) throw new Error(`Kontrak unit ${invalid.sn} tidak bisa dipulihkan (unit harus berstatus Ditarik dengan kontrak yang sudah diakhiri).`);
  if (!reason.trim()) throw new Error('Alasan pembatalan wajib diisi.');

  const penalties = assets.reduce((sum, a) => sum + (a.penaltyAmount || 0) + (a.partPenaltyAmount || 0), 0);
  const ref = await addDoc(collection(db, 'approvals'), {
    type: CANCEL_TERMINATION,
    assetIds: assets.map(a => a.id),
    assetSns: assets.map(a => a.sn),
    request: { transactionDate: new Date().toISOString().slice(0, 10), notes: reason.trim() },
    summary: `${assets.length} unit kembali Terpasang, denda ${formatIDR(penalties)} dihapus`,
    estimatedPenalty: penalties,
    status: APPROVAL_STATUS.PENDING,
    requestedBy: user.uid,
    requestedByName: actorName(),
    requestedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function decideApproval(approval: Approval, decision: 'Approved' | 'Rejected', note: string) {
  const user = requireUser();
  if (approval.status !== APPROVAL_STATUS.PENDING) throw new Error('Pengajuan ini sudah diputuskan.');
  if (approval.requestedBy === user.uid) throw new Error('Pengajuan tidak boleh disetujui oleh pengaju sendiri.');
  if (decision === 'Rejected' && !note.trim()) throw new Error('Alasan penolakan wajib diisi.');
  await updateDoc(doc(db, 'approvals', approval.id), {
    status: decision,
    decidedBy: user.uid,
    decidedByName: actorName(),
    decidedAt: serverTimestamp(),
    decisionNote: note.trim(),
  });
}

export async function cancelApproval(approval: Approval) {
  const user = requireUser();
  if (approval.requestedBy !== user.uid) throw new Error('Hanya pengaju yang bisa membatalkan pengajuannya.');
  if (approval.status !== APPROVAL_STATUS.PENDING && approval.status !== APPROVAL_STATUS.APPROVED) throw new Error('Pengajuan ini sudah selesai.');
  await updateDoc(doc(db, 'approvals', approval.id), { status: APPROVAL_STATUS.CANCELLED });
}

export interface ExecuteLookup extends Lookup {
  assetById: Map<string, Asset>;
  locations: Location[];
}

/** Eksekusi pengajuan yang sudah disetujui, memakai data unit terkini. */
export async function executeApproval(approval: Approval, lookup: ExecuteLookup): Promise<MovementResult> {
  if (approval.status !== APPROVAL_STATUS.APPROVED) throw new Error('Pengajuan belum disetujui.');
  const assets = approval.assetIds.map(id => lookup.assetById.get(id));
  const missingIdx = assets.findIndex(a => !a);
  if (missingIdx >= 0) throw new Error(`Unit ${approval.assetSns[missingIdx]} sudah tidak ada. Batalkan pengajuan ini dan ajukan ulang.`);
  const live = assets as Asset[];

  if (approval.type === CANCEL_TERMINATION) {
    const count = await cancelTermination(live, lookup, approval.id);
    return { count, baNumber: null, totalPenalty: 0 };
  }

  const r = approval.request;
  const customer = r.customerId ? lookup.customerById.get(r.customerId) || null : null;
  return executeMovement({
    type: approval.type as any,
    toStatus: r.toStatus || '',
    assets: live,
    customer,
    location: r.locationId ? lookup.locations.find(l => l.id === r.locationId) || null : null,
    transactionDate: r.transactionDate,
    notes: r.notes || '',
    picName: r.picName || '',
    technicianName: r.technicianName || '',
    damagedParts: {},
    details: (r.details || {}) as MovementDetails,
    approvalId: approval.id,
  }, lookup);
}

export const approvalTitle = (a: Pick<Approval, 'type' | 'assetSns'>) =>
  `${approvalTypeLabel(a.type)} · ${a.assetSns.length === 1 ? a.assetSns[0] : `${a.assetSns.length} unit`}`;
