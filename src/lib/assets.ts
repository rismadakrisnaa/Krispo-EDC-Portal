import { collection, deleteField, doc, serverTimestamp, writeBatch, type WriteBatch } from 'firebase/firestore';
import { addMonths, format } from 'date-fns';
import { actorName, auth, db } from './firebase';
import { ALL_STATUSES, CONDITIONS, CONNECTION_TYPES, CUSTOMER_STATUSES, INITIAL_STATUSES, PERIPHERAL_TYPES, SIM_TYPES, STATUS, statusMeta, type AssetStatus, type AssetType } from './constants';
import { cell, type Row } from './excel';
import { chunk, stripUndefined, toNumber } from './utils';
import type { Asset, DeviceModel, Supplier } from './types';

/**
 * Operasi data aset (registrasi, edit, tautan SIM/peripheral, hapus, import).
 * Status / customer / kontrak TIDAK diubah di sini kecuali saat menautkan anak ke induknya;
 * perubahan status selalu lewat lib/movements.ts.
 */

export interface AssetInput {
  assetType: AssetType;
  sn: string;
  status: string;
  vendor: string;
  model: string;
  tid: string;
  mid: string;
  osVersion: string;
  condition: string;
  imei: string;
  provider: string;
  msisdn: string;
  simType: string;
  peripheralType: string;
  /** SIM / peripheral: SN perangkat induk. */
  linkTargetSN: string;
  /** Perangkat: SN charger & battery yang tertaut. */
  chargerSN: string;
  batterySN: string;
  // Identitas tambahan
  assetTag: string;
  connectionType: string;
  modelId: string;
  // Pengadaan / penerimaan dari supplier
  supplierId: string;
  poNumber: string;
  deliveryNoteNo: string;
  receivedDate: string; // yyyy-MM-dd
  purchasePrice: string;
  warrantyUntil: string; // yyyy-MM-dd
}

/** Data penerimaan barang (GR) yang berlaku untuk semua unit dalam satu kiriman. */
export type ReceiptInput = Pick<AssetInput, 'supplierId' | 'poNumber' | 'deliveryNoteNo' | 'receivedDate' | 'purchasePrice' | 'warrantyUntil'>;

export const todayISO = () => format(new Date(), 'yyyy-MM-dd');

export const emptyReceipt = (): ReceiptInput => ({
  supplierId: '', poNumber: '', deliveryNoteNo: '', receivedDate: todayISO(), purchasePrice: '', warrantyUntil: '',
});

/** Garansi otomatis dari master model: tanggal terima + masa garansi model. */
export function defaultWarranty(receivedDate: string, model?: DeviceModel) {
  const months = Number(model?.warrantyMonths);
  const start = new Date(receivedDate);
  if (!months || isNaN(start.getTime())) return '';
  return format(addMonths(start, months), 'yyyy-MM-dd');
}

export const findModel = (models: DeviceModel[], vendor: string, model: string) =>
  models.find(m => m.brand.trim().toLowerCase() === vendor.trim().toLowerCase() && m.model.trim().toLowerCase() === model.trim().toLowerCase());

export const emptyAssetInput = (assetType: AssetType): AssetInput => ({
  assetType, sn: '', vendor: '', model: '', tid: '', mid: '', osVersion: '',
  condition: 'New', imei: '', provider: '', msisdn: '', simType: 'Public', peripheralType: '',
  linkTargetSN: '', chargerSN: '', batterySN: '',
  assetTag: '', connectionType: '', modelId: '', ...emptyReceipt(),
  status: STATUS.INCOMING,
});

const norm = (sn: string) => sn.trim().toLowerCase();

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi login berakhir. Silakan login ulang.');
  return user;
}

/** Hanya field yang relevan untuk tipe aset yang disimpan, supaya dokumen tetap bersih. */
function describeFields(input: AssetInput) {
  const t = (s: string) => s.trim();
  if (input.assetType === 'sim') {
    return { provider: t(input.provider), msisdn: t(input.msisdn), simType: input.simType || 'Public' };
  }
  if (input.assetType === 'peripheral') {
    return { peripheralType: input.peripheralType, vendor: t(input.vendor), model: t(input.model) };
  }
  return {
    vendor: t(input.vendor), model: t(input.model), tid: t(input.tid), mid: t(input.mid),
    osVersion: t(input.osVersion), condition: input.condition || 'New', imei: t(input.imei),
  };
}

const isoDate = (value: string) => {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
};

/** Field pengadaan & identitas tambahan. Berlaku untuk semua tipe aset. */
function procurementFields(input: AssetInput, suppliers: Supplier[], models: DeviceModel[]) {
  const supplier = suppliers.find(s => s.id === input.supplierId);
  const model = input.assetType === 'perangkat' ? findModel(models, input.vendor, input.model) : undefined;
  if (input.receivedDate && input.receivedDate > todayISO()) throw new Error('Tanggal terima tidak boleh di masa depan.');
  if (input.purchasePrice && !(Number(input.purchasePrice) >= 0)) throw new Error('Harga beli harus angka positif.');
  return {
    assetTag: input.assetTag.trim(),
    connectionType: input.assetType === 'perangkat' ? input.connectionType : undefined,
    modelId: model?.id ?? null,
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.name ?? null,
    poNumber: input.poNumber.trim(),
    deliveryNoteNo: input.deliveryNoteNo.trim(),
    receivedDate: isoDate(input.receivedDate),
    purchasePrice: input.purchasePrice === '' ? undefined : toNumber(input.purchasePrice),
    warrantyUntil: isoDate(input.warrantyUntil || defaultWarranty(input.receivedDate, model)),
  };
}

/** Field yang diwarisi SIM / peripheral dari perangkat induknya. */
const inheritFrom = (device: Pick<Asset, 'id' | 'sn' | 'status' | 'currentCustomerId' | 'customerName' | 'currentLocationId' | 'locationName'>) => ({
  parentDeviceId: device.id,
  parentDeviceSN: device.sn,
  status: device.status,
  currentCustomerId: device.currentCustomerId ?? null,
  customerName: device.customerName ?? null,
  currentLocationId: device.currentLocationId ?? null,
  locationName: device.locationName ?? null,
});

/** Saat tautan dilepas, SIM / peripheral kembali menjadi stok gudang. */
const detachFields = () => ({
  parentDeviceId: deleteField(),
  parentDeviceSN: deleteField(),
  status: STATUS.AVAILABLE,
  currentCustomerId: null,
  customerName: null,
  currentLocationId: null,
  locationName: null,
});

const stamp = (uid: string) => ({ updatedAt: serverTimestamp(), lastUpdatedBy: uid });

/** Log penerimaan barang (GR): awal dari riwayat setiap unit. */
function logReceipt(batch: WriteBatch, assetId: string, sn: string, data: Record<string, unknown>, source: 'manual' | 'import') {
  const user = requireUser();
  batch.set(doc(collection(db, 'movements')), stripUndefined({
    edcId: assetId, sn, type: 'Goods Receipt', toStatus: data.status, baGenerated: false,
    transactionDate: String(data.receivedDate || new Date().toISOString()).slice(0, 10),
    supplierName: data.supplierName || undefined, poNumber: data.poNumber || undefined, referenceNo: data.deliveryNoteNo || undefined,
    cost: typeof data.purchasePrice === 'number' ? data.purchasePrice : undefined,
    notes: source === 'import' ? 'Registrasi lewat import Excel.' : '',
    timestamp: serverTimestamp(), userId: user.uid, userName: actorName(),
  }));
}

function findDevice(assets: Asset[], sn: string) {
  return assets.find(a => a.assetType === 'perangkat' && norm(a.sn) === norm(sn));
}

/**
 * Tentukan aksi untuk SN charger / battery yang diketik di form perangkat:
 * tautkan peripheral yang sudah ada, atau buat baru. Melempar error jika SN bentrok.
 */
function planPeripheral(assets: Asset[], sn: string, peripheralType: string, deviceId: string | null) {
  const existing = assets.find(a => norm(a.sn) === norm(sn));
  if (!existing) return { action: 'create' as const };
  if (existing.assetType !== 'peripheral') throw new Error(`SN ${sn} sudah terdaftar sebagai ${existing.assetType === 'sim' ? 'SIM' : 'perangkat'}, tidak bisa dipakai sebagai ${peripheralType}.`);
  if (existing.parentDeviceId && existing.parentDeviceId !== deviceId) throw new Error(`${peripheralType} ${sn} masih tertaut ke perangkat ${existing.parentDeviceSN}. Lepas tautannya dulu.`);
  return { action: 'link' as const, existing };
}

export async function createAsset(input: AssetInput, assets: Asset[], suppliers: Supplier[] = [], models: DeviceModel[] = []) {
  const user = requireUser();
  const sn = input.sn.trim();
  if (!sn) throw new Error('Serial number wajib diisi.');
  if (assets.some(a => norm(a.sn) === norm(sn))) throw new Error(`Serial number ${sn} sudah terdaftar.`);
  if (!INITIAL_STATUSES.includes(input.status)) throw new Error('Status awal tidak valid.');

  const batch = writeBatch(db);
  const ref = doc(collection(db, 'edcs'));
  let data: Record<string, unknown> = {
    sn, assetType: input.assetType, status: input.status, ...describeFields(input), ...procurementFields(input, suppliers, models),
    statusSince: new Date().toISOString(), createdAt: serverTimestamp(), ...stamp(user.uid),
  };

  if (input.assetType !== 'perangkat' && input.linkTargetSN.trim()) {
    const device = findDevice(assets, input.linkTargetSN);
    if (!device) throw new Error(`Perangkat dengan SN ${input.linkTargetSN.trim()} tidak ditemukan.`);
    data = { ...data, ...inheritFrom(device) };
  }
  data = stripUndefined(data);
  batch.set(ref, data);
  logReceipt(batch, ref.id, sn, data, 'manual');

  if (input.assetType === 'perangkat') {
    const self = { id: ref.id, sn, status: input.status };
    const pairs: [string, string][] = [[input.chargerSN, 'Charger'], [input.batterySN, 'Battery']];
    const seen = new Set([norm(sn)]);
    for (const [rawSn, type] of pairs) {
      const pSn = rawSn.trim();
      if (!pSn) continue;
      if (seen.has(norm(pSn))) throw new Error(`SN ${pSn} dipakai lebih dari sekali di form ini.`);
      seen.add(norm(pSn));
      const plan = planPeripheral(assets, pSn, type, null);
      if (plan.action === 'link') {
        batch.update(doc(db, 'edcs', plan.existing.id), { ...inheritFrom(self), ...stamp(user.uid) });
      } else {
        const pRef = doc(collection(db, 'edcs'));
        batch.set(pRef, { sn: pSn, assetType: 'peripheral', peripheralType: type, vendor: input.vendor.trim(), ...inheritFrom(self), createdAt: serverTimestamp(), ...stamp(user.uid) });
      }
    }
  }
  await batch.commit();
}

export async function updateAsset(asset: Asset, input: AssetInput, assets: Asset[], suppliers: Supplier[] = [], models: DeviceModel[] = []) {
  const user = requireUser();
  if (!ALL_STATUSES.includes(asset.status as AssetStatus)) {
    throw new Error(`Status "${asset.status || 'kosong'}" berasal dari data lama dan tidak dikenal. Proses unit ini lewat Pergerakan > "Kembali ke Stok" dulu, baru edit datanya.`);
  }
  const batch = writeBatch(db);
  const update: Record<string, unknown> = { ...describeFields(input), ...procurementFields(input, suppliers, models), ...stamp(user.uid) };

  if (asset.assetType !== 'perangkat') {
    const target = input.linkTargetSN.trim();
    if (!target && asset.parentDeviceId) {
      Object.assign(update, detachFields());
    } else if (target && norm(target) !== norm(asset.parentDeviceSN || '')) {
      const device = findDevice(assets, target);
      if (!device) throw new Error(`Perangkat dengan SN ${target} tidak ditemukan.`);
      Object.assign(update, inheritFrom(device));
    }
  } else {
    const children = assets.filter(a => a.parentDeviceId === asset.id && a.assetType === 'peripheral');
    const pairs: [string, string][] = [[input.chargerSN, 'Charger'], [input.batterySN, 'Battery']];
    for (const [rawSn, type] of pairs) {
      const wanted = rawSn.trim();
      const current = children.filter(c => c.peripheralType === type);
      if (wanted && norm(wanted) === norm(asset.sn)) throw new Error(`SN ${type} tidak boleh sama dengan SN perangkat.`);
      // Lepas peripheral lama yang diganti / dikosongkan.
      for (const old of current) {
        if (norm(old.sn) !== norm(wanted)) batch.update(doc(db, 'edcs', old.id), { ...detachFields(), ...stamp(user.uid) });
      }
      if (!wanted || current.some(c => norm(c.sn) === norm(wanted))) continue;
      const plan = planPeripheral(assets, wanted, type, asset.id);
      if (plan.action === 'link') {
        batch.update(doc(db, 'edcs', plan.existing.id), { ...inheritFrom(asset), ...stamp(user.uid) });
      } else {
        batch.set(doc(collection(db, 'edcs')), { sn: wanted, assetType: 'peripheral', peripheralType: type, vendor: input.vendor.trim(), ...inheritFrom(asset), createdAt: serverTimestamp(), ...stamp(user.uid) });
      }
    }
  }

  // Field kosong di form edit tidak menghapus data lama yang tidak ada di form.
  batch.update(doc(db, 'edcs', asset.id), stripUndefined(update));
  await batch.commit();
}

export async function linkToDevice(child: Asset, deviceSn: string, assets: Asset[]) {
  const user = requireUser();
  if (child.assetType === 'perangkat') throw new Error('Hanya SIM / peripheral yang bisa ditautkan ke perangkat.');
  if (child.parentDeviceId) throw new Error(`Masih tertaut ke ${child.parentDeviceSN}. Lepas tautannya dulu.`);
  const device = findDevice(assets, deviceSn);
  if (!device) throw new Error(`Perangkat dengan SN ${deviceSn.trim()} tidak ditemukan.`);
  const batch = writeBatch(db);
  batch.update(doc(db, 'edcs', child.id), { ...inheritFrom(device), ...stamp(user.uid) });
  await batch.commit();
}

export async function unlinkFromDevice(child: Asset) {
  const user = requireUser();
  const batch = writeBatch(db);
  batch.update(doc(db, 'edcs', child.id), { ...detachFields(), ...stamp(user.uid) });
  await batch.commit();
}

/** Alasan sebuah aset tidak boleh dihapus, atau null jika boleh. */
export function deleteBlocker(asset: Asset): string | null {
  if (asset.contractStatus === 'Active') return 'kontrak masih aktif';
  if (CUSTOMER_STATUSES.includes(asset.status)) return `status ${statusMeta(asset.status).label}`;
  if ((asset.penaltyAmount || 0) + (asset.partPenaltyAmount || 0) > 0) return 'masih ada catatan denda';
  return null;
}

export async function deleteAssets(targets: Asset[], assets: Asset[]) {
  const user = requireUser();
  const blocked = targets.map(a => ({ a, reason: deleteBlocker(a) })).filter(x => x.reason);
  if (blocked.length) throw new Error(`${blocked.length} aset tidak bisa dihapus, mis. ${blocked[0].a.sn} (${blocked[0].reason}). Tarik / selesaikan dulu lewat menu Pergerakan.`);

  const ids = new Set(targets.map(a => a.id));
  const orphans = assets.filter(a => a.parentDeviceId && ids.has(a.parentDeviceId) && !ids.has(a.id));
  const ops: ((batch: WriteBatch) => void)[] = [
    ...targets.map(a => (batch: WriteBatch) => batch.delete(doc(db, 'edcs', a.id))),
    // SIM / peripheral yang induknya dihapus kembali jadi stok, bukan menggantung.
    ...orphans.map(o => (batch: WriteBatch) => batch.update(doc(db, 'edcs', o.id), { ...detachFields(), ...stamp(user.uid) })),
  ];
  for (const group of chunk(ops, 400)) {
    const batch = writeBatch(db);
    group.forEach(op => op(batch));
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// Import Excel
// ---------------------------------------------------------------------------
const PROCUREMENT_COLUMNS = { 'Asset Tag': '', 'No. PO': '', 'No. Surat Jalan': '', 'Tanggal Terima': '', 'Harga Beli': '', 'Garansi Sampai': '' };

export const IMPORT_TEMPLATES: Record<AssetType, Row[]> = {
  perangkat: [{
    'Serial Number': 'SN-DEVICE-001', Merk: 'INGENICO', Model: 'MOVE5000', TID: '', MID: '',
    'OS/Version': 'v1.0', Condition: 'New', IMEI: '', Koneksi: '4G / GPRS', 'SN Charger': 'CH-SN-001', 'SN Battery': 'BT-SN-001',
    ...PROCUREMENT_COLUMNS,
  }],
  sim: [{ ICCID: '8962000000000000001', Provider: 'TELKOMSEL', MSISDN: '081200000001', 'Jenis SIM': 'Public', 'SN Perangkat': '', ...PROCUREMENT_COLUMNS }],
  peripheral: [{ 'Serial Number': 'PERIPH-001', Jenis: 'Modem', Merk: 'HUAWEI', Model: 'E3372', 'SN Perangkat': '', ...PROCUREMENT_COLUMNS }],
};

/** Tanggal dari sel Excel: teks yyyy-mm-dd / dd-mm-yyyy / dd/mm/yyyy, atau nomor seri tanggal Excel. */
function excelDate(value: string): string {
  if (!value) return '';
  if (/^\d{4,5}(\.\d+)?$/.test(value)) {
    const d = new Date(Math.round((Number(value) - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? '' : format(d, 'yyyy-MM-dd');
  }
  const dmy = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : format(d, 'yyyy-MM-dd');
}

export interface ImportResult { imported: number; linked: number; skipped: string[] }

const pick = (value: string, allowed: string[], fallback: string) =>
  allowed.find(a => a.toLowerCase() === value.toLowerCase()) || fallback;

/**
 * Import = penerimaan barang massal. `receipt` adalah data GR untuk seluruh file;
 * kolom pengadaan di baris Excel (jika diisi) menimpa nilai default ini.
 */
export async function importAssets(
  rows: Row[], assetType: AssetType, assets: Asset[], receipt: ReceiptInput & { status: string },
  suppliers: Supplier[] = [], models: DeviceModel[] = [],
): Promise<ImportResult> {
  const user = requireUser();
  const known = new Map(assets.map(a => [norm(a.sn), a]));
  const seen = new Set<string>();
  // Perangkat yang baru dibuat di import ini juga bisa jadi induk.
  const newDevices = new Map<string, { id: string; sn: string; status: string }>();
  const ops: ((batch: WriteBatch) => void)[][] = [];
  const result: ImportResult = { imported: 0, linked: 0, skipped: [] };

  rows.forEach((row, index) => {
    const line = index + 2;
    const sn = cell(row, 'Serial Number', 'SN', 'ICCID');
    if (!sn) return;
    if (sn.length > 128) return void result.skipped.push(`Baris ${line}: SN terlalu panjang`);
    if (known.has(norm(sn)) || seen.has(norm(sn))) return void result.skipped.push(`Baris ${line}: SN ${sn} sudah terdaftar`);
    seen.add(norm(sn));

    const group: ((batch: WriteBatch) => void)[] = [];
    const ref = doc(collection(db, 'edcs'));
    // Status awal ditentukan form GR, bukan Excel, supaya unit baru tidak bisa langsung "Terpasang".
    const status = INITIAL_STATUSES.includes(receipt.status) ? receipt.status : STATUS.INCOMING;
    let data: Record<string, unknown> = { sn, assetType, status, statusSince: new Date().toISOString(), createdAt: serverTimestamp(), ...stamp(user.uid) };
    const vendor = cell(row, 'Merk', 'Vendor');
    const modelName = cell(row, 'Model');
    try {
      Object.assign(data, procurementFields({
        ...emptyAssetInput(assetType), ...receipt, vendor, model: modelName,
        assetTag: cell(row, 'Asset Tag'),
        connectionType: pick(cell(row, 'Koneksi'), CONNECTION_TYPES, ''),
        poNumber: cell(row, 'No. PO') || receipt.poNumber,
        deliveryNoteNo: cell(row, 'No. Surat Jalan') || receipt.deliveryNoteNo,
        receivedDate: excelDate(cell(row, 'Tanggal Terima')) || receipt.receivedDate,
        purchasePrice: cell(row, 'Harga Beli') || receipt.purchasePrice,
        warrantyUntil: excelDate(cell(row, 'Garansi Sampai')) || receipt.warrantyUntil,
      }, suppliers, models));
    } catch (error) {
      return void result.skipped.push(`Baris ${line}: ${(error as Error).message}`);
    }

    if (assetType === 'perangkat') {
      Object.assign(data, {
        vendor: vendor || 'UNKNOWN',
        model: modelName || 'UNKNOWN',
        tid: cell(row, 'TID'), mid: cell(row, 'MID'),
        osVersion: cell(row, 'OS/Version', 'OS Version'),
        condition: pick(cell(row, 'Condition', 'Kondisi'), CONDITIONS, 'New'),
        imei: cell(row, 'IMEI'),
      });
      const self = { id: ref.id, sn, status };
      newDevices.set(norm(sn), self);

      for (const [column, type] of [['SN Charger', 'Charger'], ['SN Battery', 'Battery']]) {
        const pSn = cell(row, column);
        if (!pSn) continue;
        if (seen.has(norm(pSn))) { result.skipped.push(`Baris ${line}: ${type} ${pSn} dobel di file`); continue; }
        const existing = known.get(norm(pSn));
        if (existing && (existing.assetType !== 'peripheral' || existing.parentDeviceId)) {
          result.skipped.push(`Baris ${line}: ${type} ${pSn} sudah terdaftar / tertaut ke unit lain`);
          continue;
        }
        seen.add(norm(pSn));
        if (existing) {
          group.push(batch => batch.update(doc(db, 'edcs', existing.id), { ...inheritFrom(self), ...stamp(user.uid) }));
        } else {
          const pRef = doc(collection(db, 'edcs'));
          group.push(batch => batch.set(pRef, { sn: pSn, assetType: 'peripheral', peripheralType: type, vendor: data.vendor, ...inheritFrom(self), createdAt: serverTimestamp(), ...stamp(user.uid) }));
        }
        result.linked++;
      }
    } else {
      if (assetType === 'sim') {
        Object.assign(data, { provider: cell(row, 'Provider'), msisdn: cell(row, 'MSISDN'), simType: pick(cell(row, 'Jenis SIM'), SIM_TYPES, 'Public') });
      } else {
        Object.assign(data, { peripheralType: pick(cell(row, 'Jenis'), PERIPHERAL_TYPES, 'Lainnya'), vendor: cell(row, 'Merk', 'Vendor'), model: cell(row, 'Model') });
      }
      const parentSn = cell(row, 'SN Perangkat');
      if (parentSn) {
        const parent = newDevices.get(norm(parentSn)) || findDevice(assets, parentSn);
        if (parent) {
          data = { ...data, ...inheritFrom(parent) };
          result.linked++;
        } else {
          result.skipped.push(`Baris ${line}: perangkat ${parentSn} tidak ditemukan, ${sn} diimpor tanpa tautan`);
        }
      }
    }

    const finalData = stripUndefined(data);
    group.unshift(
      batch => batch.set(ref, finalData),
      batch => logReceipt(batch, ref.id, sn, finalData, 'import'),
    );
    ops.push(group);
    result.imported++;
  });

  // Satu aset + log + peripheral-nya selalu dalam batch yang sama.
  let batch = writeBatch(db);
  let count = 0;
  for (const group of ops) {
    if (count + group.length > 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
    group.forEach(op => op(batch));
    count += group.length;
  }
  if (count > 0) await batch.commit();
  return result;
}
