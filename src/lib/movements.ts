import {
  collection, deleteField, doc, getDocs, increment, query, serverTimestamp, where, writeBatch, type FieldValue,
} from 'firebase/firestore';
import { actorName, auth, db } from './firebase';
import {
  ALL_STATUSES, CLOSED_STATUSES, CONTRACT_STATUS, MOVEMENT_FIELD_LABEL, REFERENCE_LABEL, STATUS, SWAP_IN_STATUSES, SWAP_OUT_STATUSES,
  movementLabel, movementRule, statusMeta, type AssetStatus, type MovementField, type MovementRule, type MovementType,
} from './constants';
import { buildInstallContract, calcTermination } from './contract';
import { downloadBAPDF, type BAData } from './baGenerator';
import { formatIDR, locationLabel, stripUndefined } from './utils';
import type { Asset, Customer, Location, Movement, Part } from './types';

/**
 * Seluruh logika perubahan status aset ada di file ini.
 * Halaman tidak boleh meng-update status / customer / kontrak aset secara langsung,
 * supaya setiap perubahan selalu (1) tervalidasi, (2) atomik bersama log-nya,
 * dan (3) ikut menggerakkan SIM / peripheral yang tertaut.
 */

// Firestore membatasi 500 operasi per batch; sisakan ruang.
const MAX_OPS_PER_BATCH = 400;

export type MovementDetails = {
  referenceNo?: string;
  courier?: string;
  serviceVendor?: string;
  cost?: number;
  conditionAfter?: string;
  disposalMethod?: string;
  disposalValue?: number;
  keyZeroized?: boolean;
};

export interface MovementRequest {
  type: MovementType;
  /** Diabaikan untuk pergerakan yang tidak mengubah status. */
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
  /** Data tambahan sesuai rule.fields. */
  details?: MovementDetails;
  /** Khusus Staging: TID / MID per unit (key = asset id). */
  unitTidMid?: Record<string, { tid: string; mid: string }>;
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

/** Tanggal pengakhiran tidak boleh lebih awal dari tanggal mulai kontrak unit. */
export function withdrawalDateProblem(assets: Asset[], transactionDate: string): string | null {
  const early = assets.find(a => a.contractStatus === CONTRACT_STATUS.ACTIVE && a.contractStartDate && transactionDate < a.contractStartDate.slice(0, 10));
  return early ? `Tanggal transaksi lebih awal dari mulai kontrak unit ${early.sn} (${early.contractStartDate!.slice(0, 10)}).` : null;
}

/** Apakah pergerakan ini mengakhiri kontrak unit tersebut. */
export const endsContract = (rule: MovementRule, asset: Asset) =>
  !!rule.terminatesContract && asset.status === STATUS.INSTALLED && asset.contractStatus === CONTRACT_STATUS.ACTIVE;

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
  if (rule.customer !== 'required' && rule.ba && eligible.length > 1) {
    const first = eligible[0].currentCustomerId || '';
    const others = eligible.filter(a => (a.currentCustomerId || '') !== first);
    if (others.length) {
      for (const asset of others) blocked.push({ asset, reason: 'customer berbeda dari unit lain (proses terpisah per customer)' });
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

/** Field wajib yang belum diisi, sebagai label yang bisa dibaca. */
export function missingDetails(rule: MovementRule, details: MovementDetails = {}): string[] {
  return (rule.required || [])
    .filter(field => {
      const value = details[field as keyof MovementDetails];
      return field === 'keyZeroized' ? value !== true : value === undefined || value === null || String(value).trim() === '';
    })
    .map(field => fieldLabel(rule.type, field));
}

export const fieldLabel = (type: MovementType, field: MovementField) =>
  field === 'referenceNo' ? REFERENCE_LABEL[type] || MOVEMENT_FIELD_LABEL.referenceNo : MOVEMENT_FIELD_LABEL[field];

const baCode: Record<string, string> = {
  'QC Pass': 'QCP', 'Return to Supplier': 'RMA', Staging: 'STG', 'Warehouse Transfer': 'MUT',
  Allocation: 'ALC', Delivery: 'DLV', Install: 'INS', Relocation: 'RLC', Maintenance: 'MNT', Swap: 'SWP',
  Repair: 'RPR', 'Return to Stock': 'RTS', Withdrawal: 'WDR', 'Write-off': 'DMG', Lost: 'LST', Disposal: 'DSP',
};

const makeBaNumber = (type: string, date: string, batchId: string) =>
  `BA/${baCode[type] || 'MOV'}/${date.replace(/-/g, '')}/${batchId.slice(0, 6).toUpperCase()}`;

const linkedLabel = (children: Asset[]) =>
  children.map(c => `${c.assetType === 'sim' ? 'SIM' : c.peripheralType || 'Peripheral'} ${c.sn}`).join(', ');

/** Bersihkan & normalkan data tambahan sesuai field yang dipakai rule. */
function cleanDetails(rule: MovementRule, details: MovementDetails = {}): MovementDetails {
  const out: MovementDetails = {};
  for (const field of rule.fields || []) {
    const value = details[field as keyof MovementDetails];
    if (value === undefined || value === null || value === '') continue;
    if (field === 'cost' || field === 'disposalValue') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${fieldLabel(rule.type, field)} harus angka positif.`);
      (out as any)[field] = n;
    } else if (field === 'keyZeroized') {
      out.keyZeroized = value === true;
    } else {
      (out as any)[field] = String(value).trim().slice(0, 200);
    }
  }
  return out;
}

/** Baris rincian di Berita Acara untuk data tambahan transaksi. */
function detailLines(type: string, details: MovementDetails): string[] {
  const rule = movementRule(type);
  const lines: string[] = [];
  const add = (field: MovementField, value: string) => lines.push(`${rule ? fieldLabel(rule.type, field) : MOVEMENT_FIELD_LABEL[field]}: ${value}`);
  if (details.referenceNo) add('referenceNo', details.referenceNo);
  if (details.courier) add('courier', details.courier);
  if (details.serviceVendor) add('serviceVendor', details.serviceVendor);
  if (details.cost) add('cost', formatIDR(details.cost));
  if (details.conditionAfter) add('conditionAfter', details.conditionAfter);
  if (details.disposalMethod) add('disposalMethod', details.disposalMethod);
  if (details.disposalValue) add('disposalValue', formatIDR(details.disposalValue));
  if (details.keyZeroized) lines.push('Key enkripsi & data terminal: sudah dihapus (zeroization).');
  return lines;
}

const VISIT_TYPES: MovementType[] = ['Install', 'Relocation', 'Maintenance'];

export interface MovementResult { count: number; baNumber: string | null; totalPenalty: number }

export async function executeMovement(req: MovementRequest, lookup: Lookup): Promise<MovementResult> {
  const rule = movementRule(req.type);
  const user = auth.currentUser;
  if (!rule) throw new Error('Tipe pergerakan tidak dikenal.');
  if (rule.type === 'Swap') throw new Error('Gunakan form Tukar Unit untuk swap.');
  if (!user) throw new Error('Sesi login berakhir. Silakan login ulang.');
  if (!rule.keepStatus && !rule.to.includes(req.toStatus)) throw new Error('Status tujuan tidak valid untuk tipe pergerakan ini.');
  if (req.assets.length === 0) throw new Error('Belum ada unit yang dipilih.');

  const { blocked } = checkEligibility(rule, req.assets);
  if (blocked.length > 0) throw new Error(`${blocked.length} unit tidak bisa diproses: ${blocked[0].asset.sn} (${blocked[0].reason}).`);
  if (rule.customer === 'required' && !req.customer) throw new Error('Customer wajib dipilih untuk pergerakan ini.');
  if (rule.locationRequired && !req.location) throw new Error('Lokasi tujuan wajib dipilih.');
  const missing = missingDetails(rule, req.details);
  if (missing.length) throw new Error(`Wajib diisi: ${missing.join(', ')}.`);
  const details = cleanDetails(rule, req.details);

  const txDate = new Date(req.transactionDate);
  if (isNaN(txDate.getTime())) throw new Error('Tanggal transaksi tidak valid.');
  if (txDate.getTime() > Date.now() + 86_400_000) throw new Error('Tanggal transaksi tidak boleh di masa depan.');

  const customer = resolveCustomer(rule, req, lookup);
  if (rule.terminatesContract) {
    const dateProblem = withdrawalDateProblem(req.assets.filter(a => endsContract(rule, a)), req.transactionDate);
    if (dateProblem) throw new Error(dateProblem);
  }
  if (rule.perUnitTidMid) {
    for (const asset of req.assets) {
      const entry = req.unitTidMid?.[asset.id];
      if ((entry?.tid || '').length > 64 || (entry?.mid || '').length > 64) throw new Error(`TID / MID unit ${asset.sn} terlalu panjang.`);
    }
  }

  const batchId = doc(collection(db, 'movements')).id;
  const baNumber = rule.ba ? makeBaNumber(req.type, req.transactionDate, batchId) : null;
  const generatedAt = new Date().toISOString();
  const technician = req.technicianName.trim();

  // --- Field untuk perangkat & SIM/peripheral tertaut, per unit karena status bisa tetap ---
  const sharedFor = (asset: Asset) => {
    const toStatus = rule.keepStatus ? asset.status : req.toStatus;
    const shared: Record<string, unknown> = { status: toStatus, updatedAt: serverTimestamp(), lastUpdatedBy: user.uid };
    if (toStatus !== asset.status) shared.statusSince = txDate.toISOString();
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
    } else if (CLOSED_STATUSES.includes(toStatus)) {
      // Unit yang keluar dari armada tidak lagi punya lokasi.
      shared.currentLocationId = null;
      shared.locationName = null;
    }
    return shared;
  };

  // --- Susun operasi per unit ---
  const units = req.assets.map(asset => {
    const children = lookup.childrenOf(asset.id);
    const shared = sharedFor(asset);
    const update: Record<string, unknown | FieldValue> = { ...shared };
    const log: Record<string, unknown> = { ...details };

    if (req.type === 'Install') {
      Object.assign(update, buildInstallContract(req.customer!, txDate), {
        contractLocationId: req.location?.id ?? null,
        contractLocationName: req.location?.name ?? null,
        contractEndDateActual: deleteField(),
        remainingMonthsAtTermination: deleteField(),
        isTerminatedInARO: deleteField(),
        damagedParts: deleteField(),
        installedDate: txDate.toISOString(),
      });
    } else if (req.type === 'Relocation') {
      update.contractLocationId = req.location?.id ?? null;
      update.contractLocationName = req.location?.name ?? null;
    }

    if (endsContract(rule, asset)) {
      const termination = terminationFor(asset, customer, txDate);
      const parts = req.type === 'Withdrawal' ? req.damagedParts[asset.id] || [] : [];
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

    if (rule.perUnitTidMid) {
      const entry = req.unitTidMid?.[asset.id];
      if (entry) {
        update.tid = entry.tid.trim();
        update.mid = entry.mid.trim();
        Object.assign(log, { tid: entry.tid.trim(), mid: entry.mid.trim() });
      }
    }
    if (VISIT_TYPES.includes(req.type)) {
      update.lastVisitDate = txDate.toISOString();
      if (technician) update.lastTechnician = technician;
    }
    if (req.type === 'Repair') update.repairCount = increment(1);
    if (details.cost && (req.type === 'Repair' || req.type === 'Return to Stock')) update.repairCostTotal = increment(details.cost);
    if (details.conditionAfter) update.condition = details.conditionAfter;
    if (req.type === 'Disposal') {
      Object.assign(update, { disposalMethod: details.disposalMethod, disposalDate: txDate.toISOString(), disposalValue: details.disposalValue ?? 0 });
    }
    if (rule.ba) update.hasBA = true;

    return { asset, children, shared, update, log, ops: 2 + children.length };
  });

  // --- Commit per chunk; tiap unit + log + anak-anaknya selalu dalam batch yang sama ---
  let processed = 0;
  let i = 0;
  while (i < units.length) {
    const batch = writeBatch(db);
    let ops = 0;
    let inBatch = 0;
    while (i < units.length && (inBatch === 0 || ops + units[i].ops <= MAX_OPS_PER_BATCH)) {
      const { asset, children, shared, update, log } = units[i];
      batch.update(doc(db, 'edcs', asset.id), stripUndefined(update));
      for (const child of children) batch.update(doc(db, 'edcs', child.id), shared);

      batch.set(doc(collection(db, 'movements')), stripUndefined({
        edcId: asset.id,
        sn: asset.sn,
        type: req.type,
        fromStatus: asset.status,
        toStatus: shared.status,
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
          ? { templateType: req.type, generatedAt, customerPIC: req.picName.trim(), customerAddress: customer?.address || '', technician }
          : null,
        linkedAssets: children.map(c => ({ sn: c.sn, type: c.assetType === 'sim' ? 'SIM' : c.peripheralType || 'Peripheral' })),
        ...log,
        timestamp: serverTimestamp(),
        userId: user.uid,
        userName: actorName(),
      }));
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
      title: rule.baTitle || rule.label,
      movementType: req.type,
      transactionDate: req.transactionDate,
      customerName: customer?.name || '-',
      customerAddress: customer?.address || '-',
      customerPIC: req.picName.trim(),
      locationName: rule.locationType ? req.location?.name || '-' : locationLabel(req.assets[0]),
      devices: units.map(u => ({
        sn: u.asset.sn, model: u.asset.model,
        tid: (u.update.tid as string) ?? u.asset.tid, mid: (u.update.mid as string) ?? u.asset.mid,
        status: statusMeta(u.shared.status as string).label, linked: linkedLabel(u.children),
      })),
      summaryLines: [...detailLines(req.type, details), ...penaltyLines(units.map(u => ({ sn: u.asset.sn, ...u.log })))],
      notes: req.notes.trim(),
      technicianName: technician,
      generatedAt,
    });
  }

  return { count: units.length, baNumber, totalPenalty };
}

// ---------------------------------------------------------------------------
// Tukar unit (swap)
// ---------------------------------------------------------------------------
export interface SwapRequest {
  oldAsset: Asset;
  newAsset: Asset;
  /** Status unit lama setelah dilepas. */
  oldTo: string;
  /** Lokasi unit lama setelah dilepas (gudang / service center), opsional. */
  oldLocation: Location | null;
  moveLinked: boolean;
  moveTidMid: boolean;
  transactionDate: string;
  notes: string;
  picName: string;
  technicianName: string;
  details?: MovementDetails;
}

/** Masalah yang membuat swap tidak bisa diproses, atau null. */
export function swapProblem(oldAsset?: Asset, newAsset?: Asset): string | null {
  if (!oldAsset) return 'Pilih unit lama yang terpasang.';
  if (oldAsset.assetType !== 'perangkat' || oldAsset.status !== STATUS.INSTALLED) return `Unit lama ${oldAsset.sn} harus berstatus Terpasang.`;
  if (oldAsset.contractStatus !== CONTRACT_STATUS.ACTIVE) return `Unit lama ${oldAsset.sn} tidak punya kontrak aktif.`;
  if (!newAsset) return 'Pilih unit pengganti dari stok.';
  if (newAsset.id === oldAsset.id) return 'Unit pengganti harus berbeda.';
  if (newAsset.assetType !== 'perangkat' || !SWAP_IN_STATUSES.includes(newAsset.status)) {
    return `Unit pengganti ${newAsset.sn} harus berstatus ${SWAP_IN_STATUSES.map(s => statusMeta(s).label).join(' / ')}.`;
  }
  return null;
}

export async function executeSwap(req: SwapRequest, lookup: Lookup): Promise<{ baNumber: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi login berakhir. Silakan login ulang.');
  const rule = movementRule('Swap')!;
  const problem = swapProblem(req.oldAsset, req.newAsset);
  if (problem) throw new Error(problem);
  if (!SWAP_OUT_STATUSES.includes(req.oldTo)) throw new Error('Status unit lama tidak valid.');
  const txDate = new Date(req.transactionDate);
  if (isNaN(txDate.getTime())) throw new Error('Tanggal transaksi tidak valid.');
  if (txDate.getTime() > Date.now() + 86_400_000) throw new Error('Tanggal transaksi tidak boleh di masa depan.');
  const details = cleanDetails(rule, req.details);

  const { oldAsset: oldA, newAsset: newA } = req;
  const at = txDate.toISOString();
  const batchId = doc(collection(db, 'movements')).id;
  const baNumber = makeBaNumber('Swap', req.transactionDate, batchId);
  const generatedAt = new Date().toISOString();
  const technician = req.technicianName.trim();
  const customer = (oldA.currentCustomerId && lookup.customerById.get(oldA.currentCustomerId)) || null;
  const stamp = { updatedAt: serverTimestamp(), lastUpdatedBy: user.uid };

  const oldChildren = lookup.childrenOf(oldA.id);
  const newChildren = lookup.childrenOf(newA.id);
  const moving = req.moveLinked ? oldChildren : [];

  const placement = {
    status: STATUS.INSTALLED, statusSince: at,
    currentCustomerId: oldA.currentCustomerId ?? null, customerName: oldA.customerName ?? null,
    currentLocationId: oldA.currentLocationId ?? null, locationName: oldA.locationName ?? null,
  };
  const released = {
    status: req.oldTo, statusSince: at, currentCustomerId: null, customerName: null,
    currentLocationId: req.oldLocation?.id ?? null, locationName: req.oldLocation?.name ?? null,
  };

  const batch = writeBatch(db);
  // Unit pengganti mewarisi kontrak berjalan apa adanya (tanggal & sewa tidak berubah).
  batch.update(doc(db, 'edcs', newA.id), stripUndefined({
    ...placement, ...stamp,
    contractStatus: CONTRACT_STATUS.ACTIVE,
    contractScheme: oldA.contractScheme,
    contractStartDate: oldA.contractStartDate,
    expectedEndDate: oldA.expectedEndDate,
    contractCustomerId: oldA.contractCustomerId ?? oldA.currentCustomerId ?? null,
    contractCustomerName: oldA.contractCustomerName ?? oldA.customerName ?? null,
    contractLocationId: oldA.contractLocationId ?? oldA.currentLocationId ?? null,
    contractLocationName: oldA.contractLocationName ?? oldA.locationName ?? null,
    currentMonthlyRental: oldA.currentMonthlyRental ?? 0,
    penaltyAmount: 0, partPenaltyAmount: 0,
    contractEndDateActual: deleteField(), remainingMonthsAtTermination: deleteField(),
    isTerminatedInARO: deleteField(), damagedParts: deleteField(),
    installedDate: at, lastVisitDate: at, lastTechnician: technician || undefined,
    ...(req.moveTidMid ? { tid: oldA.tid || '', mid: oldA.mid || '' } : {}),
    hasBA: true,
  }));
  // Unit lama keluar dari kontrak tanpa denda; riwayatnya tetap tercatat di log.
  batch.update(doc(db, 'edcs', oldA.id), {
    ...released, ...stamp,
    contractStatus: deleteField(), contractScheme: deleteField(), contractStartDate: deleteField(), expectedEndDate: deleteField(),
    contractCustomerId: deleteField(), contractCustomerName: deleteField(), contractLocationId: deleteField(), contractLocationName: deleteField(),
    currentMonthlyRental: deleteField(), penaltyAmount: deleteField(), partPenaltyAmount: deleteField(),
    ...(req.moveTidMid ? { tid: '', mid: '' } : {}),
    ...(req.oldTo === STATUS.REPAIR ? { repairCount: increment(1) } : {}),
    hasBA: true,
  });

  // SIM / peripheral: yang dipindah ikut unit pengganti, sisanya ikut unit lama.
  for (const child of moving) {
    batch.update(doc(db, 'edcs', child.id), { ...placement, ...stamp, parentDeviceId: newA.id, parentDeviceSN: newA.sn });
  }
  for (const child of oldChildren.filter(c => !moving.includes(c))) batch.update(doc(db, 'edcs', child.id), { ...released, ...stamp });
  for (const child of newChildren) batch.update(doc(db, 'edcs', child.id), { ...placement, ...stamp });

  const common = {
    batchId, baNumber, baGenerated: true, transactionDate: req.transactionDate, notes: req.notes.trim(),
    customerId: customer?.id ?? null, customerName: customer?.name ?? oldA.customerName ?? null,
    baData: { templateType: 'Swap', generatedAt, customerPIC: req.picName.trim(), customerAddress: customer?.address || '', technician },
    ...details, timestamp: serverTimestamp(), userId: user.uid, userName: actorName(),
  };
  batch.set(doc(collection(db, 'movements')), stripUndefined({
    ...common, edcId: oldA.id, sn: oldA.sn, type: 'Swap Out', fromStatus: oldA.status, toStatus: req.oldTo, swapWithSn: newA.sn,
    toLocationId: req.oldLocation?.id ?? null, toLocationName: req.oldLocation?.name ?? null,
    linkedAssets: oldChildren.filter(c => !moving.includes(c)).map(c => ({ sn: c.sn, type: c.assetType === 'sim' ? 'SIM' : c.peripheralType || 'Peripheral' })),
    tid: oldA.tid, mid: oldA.mid,
  }));
  batch.set(doc(collection(db, 'movements')), stripUndefined({
    ...common, edcId: newA.id, sn: newA.sn, type: 'Swap In', fromStatus: newA.status, toStatus: STATUS.INSTALLED, swapWithSn: oldA.sn,
    toLocationId: oldA.currentLocationId ?? null, toLocationName: oldA.locationName ?? null,
    linkedAssets: [...moving, ...newChildren].map(c => ({ sn: c.sn, type: c.assetType === 'sim' ? 'SIM' : c.peripheralType || 'Peripheral' })),
    tid: req.moveTidMid ? oldA.tid : newA.tid, mid: req.moveTidMid ? oldA.mid : newA.mid,
  }));
  await batch.commit();

  await downloadBAPDF({
    baNumber,
    title: rule.baTitle || rule.label,
    movementType: 'Swap',
    transactionDate: req.transactionDate,
    customerName: customer?.name || oldA.customerName || '-',
    customerAddress: customer?.address || '-',
    customerPIC: req.picName.trim(),
    locationName: oldA.locationName || '-',
    devices: [
      { sn: oldA.sn, model: oldA.model, tid: oldA.tid, mid: oldA.mid, status: `Dilepas: ${statusMeta(req.oldTo).label}`, linked: linkedLabel(oldChildren.filter(c => !moving.includes(c))) },
      { sn: newA.sn, model: newA.model, tid: req.moveTidMid ? oldA.tid : newA.tid, mid: req.moveTidMid ? oldA.mid : newA.mid, status: 'Dipasang (pengganti)', linked: linkedLabel([...moving, ...newChildren]) },
    ],
    summaryLines: [
      `Unit ${oldA.sn} diganti dengan ${newA.sn}. Kontrak berjalan dipindahkan ke unit pengganti tanpa denda.`,
      ...detailLines('Swap', details),
    ],
    notes: req.notes.trim(),
    technicianName: technician,
    generatedAt,
  });
  return { baNumber };
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
  const baType = move.type === 'Swap In' || move.type === 'Swap Out' ? 'Swap' : move.type;
  const txDate = move.transactionDate || move.timestamp?.toDate().toISOString().slice(0, 10) || new Date().toISOString().slice(0, 10);

  const data: BAData = {
    // Log lama belum menyimpan nomor BA: turunkan dari id log supaya tetap konsisten.
    baNumber: move.baNumber || makeBaNumber(move.type, txDate, move.id),
    title: movementRule(baType)?.baTitle || movementLabel(baType),
    movementType: baType,
    transactionDate: txDate,
    customerName: move.customerName || customer?.name || '-',
    customerAddress: move.baData?.customerAddress || customer?.address || '-',
    customerPIC: move.baData?.customerPIC || '',
    locationName: move.toLocationName || '-',
    devices: rows.map(row => {
      const asset = assetById.get(row.edcId);
      return {
        sn: row.sn || asset?.sn || row.edcId,
        model: asset?.model, tid: row.tid ?? asset?.tid, mid: row.mid ?? asset?.mid,
        status: row.type === 'Swap Out' ? `Dilepas: ${statusMeta(row.toStatus).label}` : row.type === 'Swap In' ? 'Dipasang (pengganti)' : statusMeta(row.toStatus).label,
        linked: (row.linkedAssets || []).map(l => `${l.type} ${l.sn}`).join(', '),
      };
    }),
    summaryLines: [...detailLines(baType, move), ...penaltyLines(rows)],
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
        statusSince: new Date().toISOString(),
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
