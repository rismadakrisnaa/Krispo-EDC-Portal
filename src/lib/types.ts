import type { Timestamp } from 'firebase/firestore';
import type { AssetType, LocationType } from './constants';

/** Dokumen di koleksi `edcs` (perangkat, SIM, dan peripheral). */
export interface Asset {
  id: string;
  sn: string;
  assetType: AssetType;
  status: string;
  vendor?: string;
  model?: string;
  tid?: string;
  mid?: string;
  osVersion?: string;
  condition?: string;
  imei?: string;
  // SIM
  provider?: string;
  msisdn?: string;
  simType?: string;
  // Peripheral
  peripheralType?: string;
  // Relasi SIM/peripheral -> perangkat
  parentDeviceId?: string;
  parentDeviceSN?: string;
  // Pemegang & lokasi saat ini
  currentCustomerId?: string | null;
  customerName?: string | null;
  currentLocationId?: string | null;
  locationName?: string | null;
  // Kontrak per unit
  contractStatus?: string;
  contractScheme?: string;
  contractStartDate?: string;
  expectedEndDate?: string;
  contractEndDateActual?: string;
  contractCustomerId?: string | null;
  contractCustomerName?: string | null;
  contractLocationId?: string | null;
  contractLocationName?: string | null;
  currentMonthlyRental?: number;
  penaltyAmount?: number;
  partPenaltyAmount?: number;
  remainingMonthsAtTermination?: number;
  isTerminatedInARO?: boolean;
  damagedParts?: string[];
  hasBA?: boolean;
  /** Sejak kapan unit berada di status sekarang (ISO). Dipakai untuk aging. */
  statusSince?: string;
  // Pengadaan (penerimaan dari supplier)
  assetTag?: string;
  modelId?: string;
  supplierId?: string | null;
  supplierName?: string | null;
  poNumber?: string;
  deliveryNoteNo?: string;
  receivedDate?: string;
  purchasePrice?: number;
  warrantyUntil?: string;
  connectionType?: string;
  // Operasional
  installedDate?: string;
  lastVisitDate?: string;
  lastTechnician?: string;
  repairCount?: number;
  repairCostTotal?: number;
  // Akhir masa pakai
  disposalMethod?: string;
  disposalDate?: string;
  disposalValue?: number;
  /** Pengajuan terakhir yang menyetujui perubahan status unit ini. */
  lastApprovalId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  lastUpdatedBy?: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  category?: string;
  picName?: string;
  contact?: string;
  address?: string;
  scheme?: string;
  /** Nilai sewa per unit per bulan (IDR). */
  value?: number;
  /** Durasi kontrak dalam bulan. */
  contractDuration?: number;
}

/** Gudang, service center, atau merchant (outlet milik customer). */
export interface Location {
  id: string;
  name: string;
  type: LocationType | string;
  address?: string;
  /** Wajib untuk merchant: customer pemilik outlet. */
  customerId?: string | null;
  city?: string;
  province?: string;
  postalCode?: string;
  region?: string;
  latitude?: number | null;
  longitude?: number | null;
  picName?: string;
  picPhone?: string;
  /** Kode outlet dari customer (opsional). */
  merchantCode?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

/** Master brand & tipe perangkat. */
export interface DeviceModel {
  id: string;
  brand: string;
  model: string;
  category?: string;
  warrantyMonths?: number;
  notes?: string;
}

export interface Part {
  id: string;
  name: string;
  price: number;
  description?: string;
}

export interface Movement {
  id: string;
  edcId: string;
  sn?: string;
  type: string;
  fromStatus?: string;
  toStatus?: string;
  customerId?: string | null;
  customerName?: string | null;
  toLocationId?: string | null;
  toLocationName?: string | null;
  notes?: string;
  transactionDate?: string;
  batchId?: string;
  baNumber?: string;
  baGenerated?: boolean;
  baData?: {
    templateType?: string;
    generatedAt?: string;
    customerPIC?: string;
    customerAddress?: string;
    technician?: string;
  };
  penaltyAmount?: number;
  partPenaltyAmount?: number;
  damagedParts?: string[];
  linkedAssets?: { sn: string; type: string }[];
  // Data tambahan per tipe pergerakan
  referenceNo?: string;
  courier?: string;
  serviceVendor?: string;
  cost?: number;
  conditionAfter?: string;
  disposalMethod?: string;
  disposalValue?: number;
  keyZeroized?: boolean;
  supplierName?: string;
  poNumber?: string;
  /** Swap: SN unit pasangannya. */
  swapWithSn?: string;
  tid?: string;
  mid?: string;
  timestamp?: Timestamp;
  userId?: string;
  userName?: string;
}

export interface UserProfile {
  id: string;
  /** Email login internal (username@domain). */
  email: string;
  username?: string;
  displayName?: string;
  role: string;
  status?: 'Active' | 'Inactive';
  /** true = user wajib mengganti password sementara saat login berikutnya. */
  mustChangePassword?: boolean;
}

/** Pengajuan yang wajib disetujui orang lain sebelum dieksekusi (maker-checker). */
export interface Approval {
  id: string;
  /** Tipe pergerakan, atau 'Cancel Termination'. */
  type: string;
  assetIds: string[];
  assetSns: string[];
  /** Data pergerakan yang akan dieksekusi setelah disetujui. */
  request: {
    toStatus?: string;
    customerId?: string | null;
    locationId?: string | null;
    transactionDate: string;
    notes?: string;
    picName?: string;
    technicianName?: string;
    details?: Record<string, unknown>;
  };
  /** Ringkasan untuk pemeriksa, mis. total denda. */
  summary?: string;
  estimatedPenalty?: number;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | 'Executed';
  requestedBy: string;
  requestedByName?: string;
  requestedAt?: Timestamp;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: Timestamp;
  decisionNote?: string;
  executedBy?: string;
  executedByName?: string;
  executedAt?: Timestamp;
  baNumber?: string | null;
}

export interface Attachment {
  id: string;
  parentType: 'movement' | 'approval' | 'asset';
  parentId: string;
  name: string;
  mimeType: string;
  size: number;
  /** Kategori bebas, mis. "BA bertanda tangan", "Foto instalasi". */
  label?: string;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedAt?: Timestamp;
}
