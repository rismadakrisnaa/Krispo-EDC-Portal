import {
  collection, deleteField, doc, getDocs, query, serverTimestamp, where, writeBatch, type FieldValue,
} from 'firebase/firestore';
import { actorName, auth, db } from './firebase';
import { ALL_STATUSES, CONTRACT_STATUS, STATUS, movementRule, statusMeta, type AssetStatus, type MovementRule, type MovementType } from './constants';
import { buildInstallContract, calcTermination } from './contract';
import { downloadBAPDF, type BAData } from './baGenerator';
import { formatIDR, locationLabel } from './utils';
import type { Asset, Customer, Location, Movement, Part } from './types';

/**
 * Seluruh logika perubahan status aset ada di file ini.
 * Halaman tidak boleh meng-update status / customer / kontrak aset secara langsung,
 * supaya setiap perubahan selalu (1) tervalidasi, (2) atomik bersama log-nya,
 * dan (3) ikut menggerakkan SIM / peripheral yang tertaut.
 */

// Firestore membatasi 500 operasi per batch; sisakan ruang.
const MAX_OPS_PER_BATCH = 400;

export interface MovementRequest {
  type: MovementType;
  toStatus: string;
  assets: Asset[];
  customer: Customer | null;
  location: Location | null;
  transactionDate: string; // yyyy-MM-dd
  notes: string;
  picName: string;
  technicianName: string;
  /** Khusus Withdrawal: part hilang / rusak per unit (key = asset id). */
  damagedParts: Record<string, Part[]>;
}

interface Lookup {
  childrenOf: (deviceId: string) => Asset[];
  customerById: Map<string, Customer>;
}

export interface Blocked { asset: Asset; reason: string }

const LEGACY_EXIT_TYPES: MovementType[] = ['Return to Stock', 'Write-off'];

/**
 * Pengakhiran kontrak untuk sebuah unit. Kontrak lama yang belum menyimpan nilai sewa
 * memakai nilai sewa customer pemegangnya (perilaku versi sebelumnya).
 */
export function terminationFor(asset: Asset, holder: Customer | null | undefined, date: Date) {
  return calcTermination({ ...asset, currentMonthlyRental: Number(asset.currentMonthlyRental) || Number(holder?.value) || 0 }, date);
}

/** Tanggal tarik tidak boleh lebih awal dari tanggal mulai kontrak unit. */
export function withdrawalDateProblem(assets: Asset[], transactionDate: string): string | null {
  const early = assets.find(a => a.contractStartDate && transactionDate < a.contractStartDate.slice(0, 10));
  return early ? `Tanggal transaksi lebih awal dari mulai kontrak unit ${early.sn} (${early.contractStartDate!.slice(0, 10)}).` : null;
}

/** Pisahkan unit yang boleh diproses dan yang ditolak beserta alasannya. */
export function checkEligibility(rule: MovementRule, assets: Asset[]): { eligible: Asset[]; blocked: Blocked[] } {
  const eligible: Asset[] = [];
  const blocked: Blocked[] = [];

  for (const asset of assets) {
    if (asset.assetType !== 'perangkat') {
      blocked.push({ asset, reason: 'SIM / peripheral mengikuti perangkat induknya' });
    } else if (!ALL_STATUSES.includes(asset.status as AssetStatus)) {
      // Data lama bisa punya status bebas (mis. dari import Excel versi lama).
      // Unit seperti ini hanya boleh dinormalkan dulu, supaya tidak terkunci selamanya.
      if (LEGACY_EXIT_TYPES.includes(rule.type)) eligible.push(asset);
      else blocked.push({ asset, reason: `status lama "${asset.status || 'kosong'}" tidak dikenal, proses "Kembali ke Stok" dulu` });
    } else if (!rule.from.includes(asset.status)) {
      blocked.push({ asset, reason: `status saat ini "${statusMeta(asset.status).label}"` });
    } else {
      eligible.push(asset);
    }
  }

  // Satu transaksi = satu Berita Acara = satu customer.
  if (rule.customer !== 'required' && rule.ba) {
    const holders = new Set(eligible.map(a => a.currentCustomerId || ''));
    if (holders.size > 1) {
      const first = eligible[0].currentCustomerId || '';
      for (const asset of eligible.filter(a => (a.currentCustomerId || '') !== first)) {
        blocked.push({ asset, reason: 'customer berbeda dari unit lain (proses terpisah per customer)' });
      }
      return { eligible: eligible.filter(a => (a.currentCustomerId || '') === first), blocked };
    }
  }
  return { eligible, blocked };
}

/** Customer yang tercantum di transaksi: pilihan form, atau pemegang unit saat ini. */
export function resolveCustomer(rule: MovementRule, req: Pick<MovementRequest, 'customer' | 'assets'>, lookup: Lookup): Customer | null {
  if (rule.customer === 'required') return req.customer;
  const holderId = req.assets[0]?.currentCustomerId;
  return (holderId && lookup.customerById.get(holderId)) || null;
}

const baCode: Record<string, string> = {
  Allocation: 'ALC', Delivery: 'DLV', Install: 'INS', Relocation: 'RLC', Withdrawal: 'WDR',
  Repair: 'RPR', 'Return to Stock': 'RTS', 'Write-off': 'WOF',
};

const linkedLabel = (children: Asset[]) =>
  children.map(c => `${c.assetType === 'sim' ? 'SIM' : c.peripheralType || 'Peripheral'} ${c.sn}`).join(', ');

export interface MovementResult { count: number; baNumber: string | null; totalPenalty: number }

export async function executeMovement(req: MovementRequest, lookup: Lookup): Promise<MovementResult> {
  const rule = movementRule(req.type);
  const user = auth.currentUser;
  if (!rule) throw new Error('Tipe pergerakan tidak dikenal.');
  if (!user) throw new Error('Sesi login berakhir. Silakan login ulang.');
  if (!rule.to.includes(req.toStatus)) throw new Error('Status tujuan tidak valid untuk tipe pergerakan ini.');
  if (req.assets.length === 0) throw new Error('Belum ada unit yang dipilih.');

  const { blocked } = checkEligibility(rule, req.assets);
  if (blocked.length > 0) throw new Error(`${blocked.length} unit tidak bisa diproses: ${blocked[0].asset.sn} (${blocked[0].reason}).`);
  if (rule.customer === 'required' && !req.customer) throw new Error('Customer wajib dipilih untuk pergerakan ini.');

  const txDate = new Date(req.transactionDate);
  if (isNaN(txDate.getTime())) throw new Error('Tanggal transaksi tidak valid.');
  if (txDate.getTime() > Date.now() + 86_400_000) throw new Error('Tanggal transaksi tidak boleh di masa depan.');

  const customer = resolveCustomer(rule, req, lookup);
  if (req.type === 'Withdrawal') {
    const dateProblem = withdrawalDateProblem(req.assets, req.transactionDate);
    if (dateProblem) throw new Error(dateProblem);
  }
  const batchId = doc(collection(db, 'movements')).id;
  const baNumber = rule.ba ? `BA/${baCode[req.type]}/${req.transactionDate.replace(/-/g, '')}/${batchId.slice(0, 6).toUpperCase()}` : null;
  const generatedAt = new Date().toISOString();

  // --- Field yang sama untuk perangkat & SIM/peripheral tertaut ---
  const shared: Record<string, unknown> = {
    status: req.toStatus,
    updatedAt: serverTimestamp(),
    lastUpdatedBy: user.uid,
  };
  if (rule.customer === 'required') {
    shared.currentCustomerId = req.customer!.id;
    shared.customerName = req.customer!.name;
  } else if (rule.customer === 'clear') {
    shared.currentCustomerId = null;
    shared.customerName = null;
  }
  if (rule.locationType) {
    shared.currentLocationId = req.location?.id ?? null;
    shared.locationName = req.location?.name ?? null;
  }

  // --- Susun operasi per unit ---
  const units = req.assets.map(asset => {
    const children = lookup.childrenOf(asset.id);
    const update: Record<string, unknown | FieldValue> = { ...shared };
    const log: Record<string, unknown> = {};

    if (req.type === 'Install') {
      Object.assign(update, buildInstallContract(req.customer!, txDate), {
        contractLocationId: req.location?.id ?? null,
        contractLocationName: req.location?.name ?? null,
        contractEndDateActual: deleteField(),
        remainingMonthsAtTermination: deleteField(),
        isTerminatedInARO: deleteField(),
        damagedParts: deleteField(),
      });
    } else if (req.type === 'Relocation') {
      update.contractLocationId = req.location?.id ?? null;
      update.contractLocationName = req.location?.name ?? null;
    } else if (req.type === 'Withdrawal') {
      const termination = terminationFor(asset, customer, txDate);
      const parts = req.damagedParts[asset.id] || [];
      const partPenalty = parts.reduce((sum, p) => sum + (Number(p.price) || 0), 0);
      Object.assign(update, termination || {}, {
        partPenaltyAmount: partPenalty,
        damagedParts: parts.map(p => p.name),
        // Data lama mungkin belum punya snapshot customer kontrak.
        contractCustomerId: asset.contractCustomerId ?? asset.currentCustomerId ?? null,
        contractCustomerName: asset.contractCustomerName ?? asset.customerName ?? null,
      });
      // Rincian denda ikut dicatat di log (audit trail), karena field di unit
      // akan di-reset saat unit dipasang lagi di customer berikutnya.
      Object.assign(log, {
        penaltyAmount: termination?.penaltyAmount || 0,
        partPenaltyAmount: partPenalty,
        damagedParts: parts.map(p => p.name),
        contractStatus: termination?.contractStatus || null,
      });
    }
    if (rule.ba) update.hasBA = true;

    return { asset, children, update, log, ops: 2 + children.length };
  });

  // --- Commit per chunk; tiap unit + log + anak-anaknya selalu dalam batch yang sama ---
  let processed = 0;
  let i = 0;
  while (i < units.length) {
    const batch = writeBatch(db);
    let ops = 0;
    let inBatch = 0;
    while (i < units.length && (inBatch === 0 || ops + units[i].ops <= MAX_OPS_PER_BATCH)) {
      const { asset, children, update, log } = units[i];
      batch.update(doc(db, 'edcs', asset.id), update);
      for (const child of children) batch.update(doc(db, 'edcs', child.id), shared);

      batch.set(doc(collection(db, 'movements')), {
        edcId: asset.id,
        sn: asset.sn,
        type: req.type,
        fromStatus: asset.status,
        toStatus: req.toStatus,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        toLocationId: rule.locationType ? req.location?.id ?? null : asset.currentLocationId ?? null,
        toLocationName: rule.locationType ? req.location?.name ?? null : asset.locationName ?? null,
        notes: req.notes.trim(),
        transactionDate: req.transactionDate,
        batchId,
        baNumber,
        baGenerated: rule.ba,
        baData: rule.ba
          ? { templateType: req.type, generatedAt, customerPIC: req.picName.trim(), customerAddress: customer?.address || '', technician: req.technicianName.trim() }
          : null,
        linkedAssets: children.map(c => ({ sn: c.sn, type: c.assetType === 'sim' ? 'SIM' : c.peripheralType || 'Peripheral' })),
        ...log,
        timestamp: serverTimestamp(),
        userId: user.uid,
        userName: actorName(),
      });
      ops += units[i].ops;
      inBatch++;
      i++;
    }
    try {
      await batch.commit();
      processed += inBatch;
    } catch (error) {
      if (processed > 0) {
        throw new Error(`${processed} dari ${units.length} unit berhasil diproses, sisanya gagal. Muat ulang dan proses ulang unit yang belum berubah status.`);
      }
      throw error;
    }
  }

  const totalPenalty = units.reduce((sum, u) => sum + (Number(u.log.penaltyAmount) || 0) + (Number(u.log.partPenaltyAmount) || 0), 0);

  if (rule.ba && baNumber) {
    await downloadBAPDF({
      baNumber,
      movementType: req.type,
      transactionDate: req.transactionDate,
      customerName: customer?.name || '-',
      customerAddress: customer?.address || '-',
      customerPIC: req.picName.trim(),
      locationName: rule.locationType ? req.location?.name || '-' : locationLabel(req.assets[0]),
      devices: units.map(u => ({
        sn: u.asset.sn, model: u.asset.model, tid: u.asset.tid, mid: u.asset.mid,
        status: statusMeta(req.toStatus).label, linked: linkedLabel(u.children),
      })),
      summaryLines: penaltyLines(units.map(u => ({ sn: u.asset.sn, ...u.log }))),
      notes: req.notes.trim(),
      technicianName: req.technicianName.trim(),
      generatedAt,
    });
  }

  return { count: units.length, baNumber, totalPenalty };
}

function penaltyLines(rows: { sn?: string; penaltyAmount?: unknown; partPenaltyAmount?: unknown; damagedParts?: unknown }[]): string[] {
  const lines: string[] = [];
  let total = 0;
  for (const row of rows) {
    const early = Number(row.penaltyAmount) || 0;
    const part = Number(row.partPenaltyAmount) || 0;
    if (early + part === 0) continue;
    total += early + part;
    const parts = Array.isArray(row.damagedParts) && row.damagedParts.length ? ` (${row.damagedParts.join(', ')})` : '';
    lines.push(`${row.sn}: denda pengakhiran ${formatIDR(early)}, denda part ${formatIDR(part)}${parts}`);
  }
  if (lines.length) lines.push(`Total kewajiban: ${formatIDR(total)}`);
  return lines;
}

/**
 * Unduh ulang BA dari log. Semua unit dalam transaksi yang sama (batchId) muncul
 * di satu dokumen dengan nomor BA yang sama seperti saat pertama diterbitkan.
 */
export async function redownloadBA(move: Movement, assetById: Map<string, Asset>, customerById: Map<string, Customer>) {
  let rows: Movement[] = [move];
  if (move.batchId) {
    const snap = await getDocs(query(collection(db, 'movements'), where('batchId', '==', move.batchId)));
    if (!snap.empty) rows = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Movement);
    rows.sort((a, b) => (a.sn || '').localeCompare(b.sn || ''));
  }

  const customer = move.customerId ? customerById.get(move.customerId) : undefined;
  const txDate = move.transactionDate || move.timestamp?.toDate().toISOString().slice(0, 10) || new Date().toISOString().slice(0, 10);

  const data: BAData = {
    // Log lama belum menyimpan nomor BA: turunkan dari id log supaya tetap konsisten.
    baNumber: move.baNumber || `BA/${(baCode[move.type] || 'MOV')}/${txDate.replace(/-/g, '')}/${move.id.slice(0, 6).toUpperCase()}`,
    movementType: move.type,
    transactionDate: txDate,
    customerName: move.customerName || customer?.name || '-',
    customerAddress: move.baData?.customerAddress || customer?.address || '-',
    customerPIC: move.baData?.customerPIC || '',
    locationName: move.toLocationName || '-',
    devices: rows.map(row => {
      const asset = assetById.get(row.edcId);
      return {
        sn: row.sn || asset?.sn || row.edcId,
        model: asset?.model, tid: asset?.tid, mid: asset?.mid,
        status: statusMeta(row.toStatus).label,
        linked: (row.linkedAssets || []).map(l => `${l.type} ${l.sn}`).join(', '),
      };
    }),
    summaryLines: penaltyLines(rows),
    notes: move.notes,
    technicianName: move.baData?.technician || move.userName || '',
    generatedAt: move.baData?.generatedAt || move.timestamp?.toDate().toISOString() || new Date().toISOString(),
  };
  await downloadBAPDF(data);
}

/**
 * Batalkan pengakhiran kontrak: unit kembali terpasang di customer kontraknya,
 * denda dihapus, dan SIM / peripheral tertaut ikut dipulihkan.
 */
export async function cancelTermination(assets: Asset[], lookup: Lookup): Promise<number> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi login berakhir. Silakan login ulang.');

  const targets = assets.filter(a => a.contractStatus && a.contractStatus !== CONTRACT_STATUS.ACTIVE);
  const notWithdrawn = targets.find(a => a.status !== STATUS.WITHDRAWN);
  if (notWithdrawn) {
    throw new Error(`Unit ${notWithdrawn.sn} sudah berpindah status (${statusMeta(notWithdrawn.status).label}) sejak ditarik, sehingga pengakhirannya tidak bisa dibatalkan.`);
  }

  const units = targets.map(asset => ({ asset, children: lookup.childrenOf(asset.id) }));
  let i = 0;
  while (i < units.length) {
    const batch = writeBatch(db);
    let ops = 0;
    let inBatch = 0;
    while (i < units.length && (inBatch === 0 || ops + 2 + units[i].children.length <= MAX_OPS_PER_BATCH)) {
      const { asset, children } = units[i];
      const customerId = asset.contractCustomerId ?? asset.currentCustomerId ?? null;
      const customerName = asset.contractCustomerName ?? asset.customerName ?? (customerId ? lookup.customerById.get(customerId)?.name : null) ?? null;
      const shared = {
        status: STATUS.INSTALLED,
        currentCustomerId: customerId,
        customerName,
        currentLocationId: asset.contractLocationId ?? null,
        locationName: asset.contractLocationName ?? null,
        updatedAt: serverTimestamp(),
        lastUpdatedBy: user.uid,
      };
      batch.update(doc(db, 'edcs', asset.id), {
        ...shared,
        contractStatus: CONTRACT_STATUS.ACTIVE,
        penaltyAmount: 0,
        partPenaltyAmount: 0,
        contractEndDateActual: deleteField(),
        remainingMonthsAtTermination: deleteField(),
        isTerminatedInARO: deleteField(),
        damagedParts: deleteField(),
      });
      for (const child of children) batch.update(doc(db, 'edcs', child.id), shared);
      batch.set(doc(collection(db, 'movements')), {
        edcId: asset.id,
        sn: asset.sn,
        type: 'Cancel Termination',
        fromStatus: asset.status,
        toStatus: STATUS.INSTALLED,
        customerId,
        customerName,
        notes: `Pembatalan pengakhiran kontrak. Denda dihapus: ${formatIDR((asset.penaltyAmount || 0) + (asset.partPenaltyAmount || 0))}.`,
        transactionDate: new Date().toISOString().slice(0, 10),
        baGenerated: false,
        timestamp: serverTimestamp(),
        userId: user.uid,
        userName: actorName(),
      });
      ops += 2 + children.length;
      inBatch++;
      i++;
    }
    await batch.commit();
  }
  return units.length;
}
