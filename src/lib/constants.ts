/**
 * Satu sumber kebenaran untuk status aset, tipe pergerakan, role, dan hak akses.
 * Semua halaman HARUS memakai konstanta di sini supaya data antar menu selalu sinkron.
 * Matriks hak akses di bawah dicerminkan 1:1 di firestore.rules.
 */

// ---------------------------------------------------------------------------
// Login username + password
// ---------------------------------------------------------------------------
// Firebase Auth butuh format email, jadi username dipetakan ke email internal
// `username@<domain ini>`. Email ini tidak pernah dikirimi apa pun.
// Harus sama dengan loginDomain() di firestore.rules.
export const LOGIN_EMAIL_DOMAIN = 'krispo-edc.local';

// Username admin pertama (bootstrap). Harus sama dengan isBootstrapAdmin() di firestore.rules.
export const BOOTSTRAP_ADMIN_USERNAME = 'admin';

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const MIN_PASSWORD_LENGTH = 8;

export const normalizeUsername = (value: string) => value.trim().toLowerCase();

/** Input login boleh username biasa, atau email lengkap untuk akun khusus. */
export const loginEmailFor = (usernameOrEmail: string) => {
  const value = normalizeUsername(usernameOrEmail);
  return value.includes('@') ? value : `${value}@${LOGIN_EMAIL_DOMAIN}`;
};

export const usernameFromEmail = (email?: string | null) =>
  (email || '').toLowerCase().endsWith(`@${LOGIN_EMAIL_DOMAIN}`) ? (email || '').split('@')[0].toLowerCase() : email || '';

export const BOOTSTRAP_ADMIN_EMAIL = loginEmailFor(BOOTSTRAP_ADMIN_USERNAME);

// ---------------------------------------------------------------------------
// Status aset
// ---------------------------------------------------------------------------
export const STATUS = {
  INCOMING: 'Incoming Stock',
  AVAILABLE: 'Available in Warehouse',
  STAGED: 'Staged / Ready',
  RESERVED: 'Reserved / Allocated',
  IN_DELIVERY: 'In Delivery',
  INSTALLED: 'Installed / Active',
  WITHDRAWN: 'Withdrawn',
  REPAIR: 'Under Repair',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  RETURNED_SUPPLIER: 'Returned to Supplier',
  RETIRED: 'Retired',
} as const;

export type AssetStatus = (typeof STATUS)[keyof typeof STATUS];

export const ALL_STATUSES: AssetStatus[] = Object.values(STATUS);

export const STATUS_META: Record<string, { label: string; badge: string; chart: string }> = {
  [STATUS.INCOMING]: { label: 'Stok Masuk (QC)', badge: 'bg-sky-50 text-sky-700 border-sky-200', chart: '#0EA5E9' },
  [STATUS.AVAILABLE]: { label: 'Tersedia', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', chart: '#10B981' },
  [STATUS.STAGED]: { label: 'Siap Pasang', badge: 'bg-lime-50 text-lime-700 border-lime-200', chart: '#84CC16' },
  [STATUS.RESERVED]: { label: 'Dialokasikan', badge: 'bg-violet-50 text-violet-700 border-violet-200', chart: '#8B5CF6' },
  [STATUS.IN_DELIVERY]: { label: 'Dalam Pengiriman', badge: 'bg-amber-50 text-amber-700 border-amber-200', chart: '#F59E0B' },
  [STATUS.INSTALLED]: { label: 'Terpasang', badge: 'bg-blue-50 text-blue-700 border-blue-200', chart: '#3B82F6' },
  [STATUS.WITHDRAWN]: { label: 'Ditarik (Gudang)', badge: 'bg-teal-50 text-teal-700 border-teal-200', chart: '#14B8A6' },
  [STATUS.REPAIR]: { label: 'Perbaikan', badge: 'bg-orange-50 text-orange-700 border-orange-200', chart: '#F97316' },
  [STATUS.DAMAGED]: { label: 'Rusak', badge: 'bg-red-50 text-red-700 border-red-200', chart: '#EF4444' },
  [STATUS.LOST]: { label: 'Hilang', badge: 'bg-rose-50 text-rose-700 border-rose-200', chart: '#E11D48' },
  [STATUS.RETURNED_SUPPLIER]: { label: 'Diretur ke Supplier', badge: 'bg-stone-100 text-stone-700 border-stone-300', chart: '#78716C' },
  [STATUS.RETIRED]: { label: 'Dihapuskan', badge: 'bg-gray-100 text-gray-600 border-gray-300', chart: '#6B7280' },
};

export const statusMeta = (status?: string) =>
  STATUS_META[status || ''] || { label: status || 'Tanpa Status', badge: 'bg-gray-50 text-gray-700 border-gray-200', chart: '#94A3B8' };

/** Status yang dihitung sebagai stok siap pakai di gudang. */
export const STOCK_STATUSES: string[] = [STATUS.AVAILABLE, STATUS.WITHDRAWN, STATUS.STAGED];
/** Status di mana aset sedang dipegang / disiapkan untuk customer. */
export const CUSTOMER_STATUSES: string[] = [STATUS.RESERVED, STATUS.IN_DELIVERY, STATUS.INSTALLED];
/** Status di mana unit sudah dipesan / dalam perjalanan ke customer. */
export const TRANSIT_STATUSES: string[] = [STATUS.RESERVED, STATUS.IN_DELIVERY];
/** Status bermasalah yang butuh tindak lanjut. */
export const PROBLEM_STATUSES: string[] = [STATUS.INCOMING, STATUS.REPAIR, STATUS.DAMAGED];
/** Status akhir: unit sudah keluar dari armada aktif. */
export const CLOSED_STATUSES: string[] = [STATUS.LOST, STATUS.RETURNED_SUPPLIER, STATUS.RETIRED];

/**
 * Grup status untuk filter. Dashboard dan menu Aset memakai definisi yang sama,
 * sehingga angka di kartu dashboard selalu cocok dengan daftar yang dibuka.
 */
export const STATUS_GROUPS: Record<string, { label: string; statuses: string[] }> = {
  active: { label: 'Semua aset aktif (tanpa yang sudah keluar)', statuses: ALL_STATUSES.filter(s => !CLOSED_STATUSES.includes(s)) },
  stock: { label: 'Stok gudang (siap pakai)', statuses: STOCK_STATUSES },
  customer: { label: 'Di customer (alokasi, kirim, terpasang)', statuses: CUSTOMER_STATUSES },
  transit: { label: 'Alokasi / dalam pengiriman', statuses: TRANSIT_STATUSES },
  problem: { label: 'Perlu tindakan (QC, perbaikan, rusak)', statuses: PROBLEM_STATUSES },
  closed: { label: 'Sudah keluar (hilang, retur, dihapuskan)', statuses: CLOSED_STATUSES },
};

export const matchesStatusFilter = (filter: string, status: string) =>
  !filter || filter === 'All' || (STATUS_GROUPS[filter] ? STATUS_GROUPS[filter].statuses.includes(status) : status === filter);

/** Status awal yang boleh dipilih saat registrasi / import aset. */
export const INITIAL_STATUSES: string[] = [STATUS.INCOMING, STATUS.AVAILABLE];

// ---------------------------------------------------------------------------
// Tipe aset
// ---------------------------------------------------------------------------
export type AssetType = 'perangkat' | 'sim' | 'peripheral';

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  perangkat: 'Perangkat',
  sim: 'SIM Card',
  peripheral: 'Peripheral',
};

export const PERIPHERAL_TYPES = ['Charger', 'Battery', 'Modem', 'Dongle', 'Lainnya'];
export const CONDITIONS = ['New', 'Refurbished', 'Second'];
export const SIM_TYPES = ['Public', 'Private'];

// ---------------------------------------------------------------------------
// Pergerakan (lifecycle dari hulu ke hilir)
// ---------------------------------------------------------------------------
export type MovementType =
  | 'QC Pass'
  | 'Return to Supplier'
  | 'Staging'
  | 'Warehouse Transfer'
  | 'Allocation'
  | 'Delivery'
  | 'Install'
  | 'Relocation'
  | 'Maintenance'
  | 'Swap'
  | 'Repair'
  | 'Return to Stock'
  | 'Withdrawal'
  | 'Write-off'
  | 'Lost'
  | 'Disposal';

export type LocationType = 'Warehouse' | 'Merchant Site' | 'Service Center';
export const LOCATION_TYPES: LocationType[] = ['Warehouse', 'Merchant Site', 'Service Center'];
export const LOCATION_TYPE_LABEL: Record<string, string> = { Warehouse: 'Gudang', 'Merchant Site': 'Merchant', 'Service Center': 'Service Center' };

export const MOVEMENT_PHASES = ['Pengadaan', 'Persiapan', 'Distribusi', 'Operasional', 'Service', 'Akhir Masa Pakai'] as const;
export type MovementPhase = (typeof MOVEMENT_PHASES)[number];

/** Data tambahan per transaksi. Disimpan di log pergerakan. */
export type MovementField =
  | 'referenceNo'
  | 'courier'
  | 'serviceVendor'
  | 'cost'
  | 'conditionAfter'
  | 'disposalMethod'
  | 'disposalValue'
  | 'keyZeroized';

export interface MovementRule {
  type: MovementType;
  phase: MovementPhase;
  label: string;
  description: string;
  /** Status asal yang diizinkan. */
  from: string[];
  /** Status tujuan. Lebih dari satu = user memilih. Kosong + keepStatus = status tidak berubah. */
  to: string[];
  /** Status unit tidak berubah (mis. mutasi gudang, kunjungan). */
  keepStatus?: boolean;
  /** required: wajib pilih customer; keep: pakai customer yang sedang memegang unit; clear: lepas dari customer. */
  customer: 'required' | 'keep' | 'clear';
  /** Tipe lokasi tujuan. null = lokasi tidak berubah. */
  locationType: LocationType | null;
  /** Lokasi tujuan wajib dipilih. */
  locationRequired?: boolean;
  /** Apakah Berita Acara (PDF) diterbitkan untuk pergerakan ini. */
  ba: boolean;
  /** Judul BA bila berbeda dari label. */
  baTitle?: string;
  /** Data tambahan yang ditanyakan di form; `required` wajib diisi. */
  fields?: MovementField[];
  required?: MovementField[];
  /** Isi TID / MID per unit (staging). */
  perUnitTidMid?: boolean;
  /** Mengakhiri kontrak aktif & menghitung denda (Withdrawal, Lost dari unit terpasang). */
  terminatesContract?: boolean;
}

export const MOVEMENT_FIELD_LABEL: Record<MovementField, string> = {
  referenceNo: 'No. Referensi',
  courier: 'Kurir / Ekspedisi',
  serviceVendor: 'Vendor Service',
  cost: 'Biaya (IDR)',
  conditionAfter: 'Kondisi Unit Setelah Ini',
  disposalMethod: 'Metode Penghapusan',
  disposalValue: 'Nilai Jual / Pemulihan (IDR)',
  keyZeroized: 'Key enkripsi & data sudah dihapus (zeroization)',
};

/** Label "No. Referensi" yang lebih spesifik per tipe pergerakan. */
export const REFERENCE_LABEL: Partial<Record<MovementType, string>> = {
  'Return to Supplier': 'No. RMA / Retur',
  'Warehouse Transfer': 'No. Surat Jalan Mutasi',
  Delivery: 'No. Resi / Surat Jalan',
  Maintenance: 'No. Tiket Kunjungan',
  Swap: 'No. Tiket Gangguan',
  Repair: 'No. Tiket Service',
  Lost: 'No. Laporan Polisi / Kehilangan',
  Disposal: 'No. Memo Persetujuan',
};

export const DISPOSAL_METHODS = ['Scrap / Dimusnahkan', 'Dijual', 'Hibah', 'Dikembalikan ke Vendor'];

/** Status unit lama setelah ditukar (swap). */
export const SWAP_OUT_STATUSES: string[] = [STATUS.REPAIR, STATUS.DAMAGED, STATUS.WITHDRAWN];
/** Status unit pengganti yang boleh dipakai swap. */
export const SWAP_IN_STATUSES: string[] = [STATUS.AVAILABLE, STATUS.WITHDRAWN, STATUS.STAGED];

const IN_STOCK = [STATUS.AVAILABLE, STATUS.WITHDRAWN, STATUS.STAGED];

export const MOVEMENT_RULES: MovementRule[] = [
  // ---- Pengadaan
  {
    type: 'QC Pass', phase: 'Pengadaan', label: 'Lolos QC (Terima ke Stok)',
    description: 'Unit dari supplier sudah diperiksa dan lolos QC, siap menjadi stok gudang.',
    from: [STATUS.INCOMING], to: [STATUS.AVAILABLE], customer: 'clear', locationType: 'Warehouse', ba: false,
  },
  {
    type: 'Return to Supplier', phase: 'Pengadaan', label: 'Retur ke Supplier (RMA)',
    description: 'Unit cacat / gagal QC / klaim garansi dikembalikan ke supplier.',
    from: [STATUS.INCOMING, STATUS.AVAILABLE, STATUS.WITHDRAWN, STATUS.REPAIR, STATUS.DAMAGED], to: [STATUS.RETURNED_SUPPLIER],
    customer: 'clear', locationType: null, ba: true, baTitle: 'Retur ke Supplier', fields: ['referenceNo', 'courier'], required: ['referenceNo'],
  },
  // ---- Persiapan
  {
    type: 'Staging', phase: 'Persiapan', label: 'Staging / Konfigurasi',
    description: 'Unit dikonfigurasi (injeksi key, TID/MID, aplikasi, SIM) dan siap dipasang.',
    from: [STATUS.AVAILABLE, STATUS.WITHDRAWN], to: [STATUS.STAGED], customer: 'clear', locationType: null, ba: false, perUnitTidMid: true,
  },
  {
    type: 'Warehouse Transfer', phase: 'Persiapan', label: 'Mutasi Antar Gudang',
    description: 'Pindah stok ke gudang lain. Status unit tidak berubah.',
    from: [STATUS.INCOMING, ...IN_STOCK, STATUS.DAMAGED], to: [], keepStatus: true,
    customer: 'keep', locationType: 'Warehouse', locationRequired: true, ba: true, baTitle: 'Serah Terima Mutasi Gudang', fields: ['referenceNo', 'courier'],
  },
  // ---- Distribusi
  {
    type: 'Allocation', phase: 'Distribusi', label: 'Alokasi ke Customer',
    description: 'Booking unit gudang untuk customer tertentu. Unit belum keluar gudang.',
    from: IN_STOCK, to: [STATUS.RESERVED], customer: 'required', locationType: null, ba: false,
  },
  {
    type: 'Delivery', phase: 'Distribusi', label: 'Kirim ke Merchant',
    description: 'Unit keluar gudang menuju merchant.',
    from: [...IN_STOCK, STATUS.RESERVED], to: [STATUS.IN_DELIVERY], customer: 'required', locationType: 'Merchant Site', ba: true,
    baTitle: 'Serah Terima Pengiriman', fields: ['referenceNo', 'courier'],
  },
  {
    type: 'Install', phase: 'Distribusi', label: 'Pasang (Install)',
    description: 'Unit terpasang di merchant. Kontrak sewa per unit mulai berjalan dari tanggal transaksi.',
    from: [...IN_STOCK, STATUS.RESERVED, STATUS.IN_DELIVERY], to: [STATUS.INSTALLED], customer: 'required', locationType: 'Merchant Site', ba: true,
    baTitle: 'Instalasi',
  },
  // ---- Operasional
  {
    type: 'Relocation', phase: 'Operasional', label: 'Relokasi',
    description: 'Pindah lokasi pemasangan ke merchant lain milik customer yang sama. Kontrak tidak berubah.',
    from: [STATUS.INSTALLED], to: [STATUS.INSTALLED], customer: 'keep', locationType: 'Merchant Site', locationRequired: true, ba: true,
  },
  {
    type: 'Maintenance', phase: 'Operasional', label: 'Kunjungan / Maintenance',
    description: 'Kunjungan teknisi ke merchant (preventive maintenance, ganti SIM, update aplikasi, training). Status tidak berubah.',
    from: [STATUS.INSTALLED], to: [], keepStatus: true, customer: 'keep', locationType: null, ba: true, baTitle: 'Kunjungan Teknisi', fields: ['referenceNo'],
  },
  {
    type: 'Swap', phase: 'Operasional', label: 'Tukar Unit (Swap)',
    description: 'Unit terpasang yang bermasalah diganti unit stok. Kontrak, merchant, dan TID/MID pindah ke unit pengganti tanpa denda.',
    from: [STATUS.INSTALLED], to: [], customer: 'keep', locationType: null, ba: true, baTitle: 'Penggantian Unit', fields: ['referenceNo'],
  },
  // ---- Service
  {
    type: 'Repair', phase: 'Service', label: 'Kirim Perbaikan',
    description: 'Unit gudang dikirim ke service center / vendor service.',
    from: [STATUS.INCOMING, ...IN_STOCK, STATUS.DAMAGED], to: [STATUS.REPAIR], customer: 'clear', locationType: 'Service Center', ba: false,
    fields: ['referenceNo', 'serviceVendor', 'cost'],
  },
  {
    type: 'Return to Stock', phase: 'Service', label: 'Kembali ke Stok / Refurbish',
    description: 'Unit kembali menjadi stok siap pakai: selesai perbaikan / refurbish, batal alokasi, atau gagal kirim.',
    from: [STATUS.WITHDRAWN, STATUS.STAGED, STATUS.RESERVED, STATUS.IN_DELIVERY, STATUS.REPAIR, STATUS.DAMAGED], to: [STATUS.AVAILABLE],
    customer: 'clear', locationType: 'Warehouse', ba: false, fields: ['conditionAfter', 'cost'],
  },
  // ---- Akhir masa pakai
  {
    type: 'Withdrawal', phase: 'Akhir Masa Pakai', label: 'Tarik (Withdrawal)',
    description: 'Unit ditarik dari merchant. Kontrak diakhiri dan denda dihitung otomatis.',
    from: [STATUS.INSTALLED], to: [STATUS.WITHDRAWN], customer: 'clear', locationType: 'Warehouse', ba: true, baTitle: 'Penarikan',
    terminatesContract: true,
  },
  {
    type: 'Write-off', phase: 'Akhir Masa Pakai', label: 'Tandai Rusak',
    description: 'Unit dinyatakan rusak dan menunggu keputusan: perbaikan, retur supplier, atau penghapusan.',
    from: [STATUS.INCOMING, ...IN_STOCK, STATUS.RESERVED, STATUS.REPAIR], to: [STATUS.DAMAGED], customer: 'clear', locationType: null, ba: false,
  },
  {
    type: 'Lost', phase: 'Akhir Masa Pakai', label: 'Hilang / Dicuri',
    description: 'Unit hilang. Jika unit sedang terpasang, kontraknya diakhiri dan denda dihitung otomatis. Segera blokir TID di host.',
    from: [STATUS.INCOMING, ...IN_STOCK, STATUS.RESERVED, STATUS.IN_DELIVERY, STATUS.INSTALLED, STATUS.REPAIR, STATUS.DAMAGED], to: [STATUS.LOST],
    customer: 'clear', locationType: null, ba: true, baTitle: 'Kehilangan', fields: ['referenceNo'], terminatesContract: true,
  },
  {
    type: 'Disposal', phase: 'Akhir Masa Pakai', label: 'Penghapusan (Disposal)',
    description: 'Unit dikeluarkan permanen dari aset. Wajib memastikan key enkripsi & data sudah dihapus.',
    from: [...IN_STOCK, STATUS.REPAIR, STATUS.DAMAGED], to: [STATUS.RETIRED], customer: 'clear', locationType: null, ba: true,
    baTitle: 'Penghapusan Aset', fields: ['referenceNo', 'disposalMethod', 'disposalValue', 'keyZeroized'], required: ['disposalMethod', 'keyZeroized'],
  },
];

export const movementRule = (type: string) => MOVEMENT_RULES.find(r => r.type === type);

/** Label tampilan untuk tipe pergerakan, termasuk tipe sistem & data lama. */
export const movementLabel = (type?: string) => {
  const rule = movementRule(type || '');
  if (rule) return rule.label;
  if (!type) return 'Update';
  if (type === 'Goods Receipt') return 'Penerimaan dari Supplier';
  if (type.startsWith('Initial stock')) return type.includes('Import') ? 'Registrasi (Import)' : 'Registrasi Aset';
  if (type.startsWith('Cancel Termination')) return 'Batal Pengakhiran Kontrak';
  if (type === 'Swap Out') return 'Swap: Unit Dilepas';
  if (type === 'Swap In') return 'Swap: Unit Pengganti Dipasang';
  if (type === 'Write-off') return 'Rusak / Hilang / Hapus';
  return type;
};

// ---------------------------------------------------------------------------
// Pengadaan & master perangkat
// ---------------------------------------------------------------------------
export const DEVICE_CATEGORIES = ['EDC Android', 'EDC Konvensional', 'mPOS', 'Soundbox / QRIS', 'Lainnya'];
export const CONNECTION_TYPES = ['4G / GPRS', 'WiFi', 'LAN / Ethernet', 'Dial-up', 'Bluetooth'];
export const DEFAULT_WARRANTY_MONTHS = 12;
/** Unit dianggap menganggur jika tidak bergerak selama ini di status stok. */
export const IDLE_STOCK_DAYS = 90;

// ---------------------------------------------------------------------------
// Kontrak
// ---------------------------------------------------------------------------
export const CONTRACT_STATUS = {
  ACTIVE: 'Active',
  TERMINATED_NORMAL: 'Terminated (Normal)',
  TERMINATED_EARLY: 'Terminated (Early)',
} as const;

export const SCHEMES = ['Sewa', 'Managed Service', 'Jual Putus', 'Pinjam Pakai', 'Konsinyasi'];
export const CUSTOMER_CATEGORIES = ['Retail', 'Enterprise', 'Government', 'Strategic Partner'];
export const DEFAULT_CONTRACT_MONTHS = 12;
export const ARO_RENEWAL_MONTHS = 12;

// ---------------------------------------------------------------------------
// Role & hak akses (dicerminkan di firestore.rules)
// ---------------------------------------------------------------------------
export const ROLES = ['Admin', 'Operations', 'Warehouse', 'Service', 'Account Manager', 'Management'] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | 'assets.create'
  | 'assets.update'
  | 'movements.create'
  | 'customers.write'
  | 'locations.write'
  | 'parts.write'
  | 'suppliers.write'
  | 'delete'
  | 'users.manage';

const PERMISSIONS: Record<Role, Permission[]> = {
  Admin: ['assets.create', 'assets.update', 'movements.create', 'customers.write', 'locations.write', 'parts.write', 'suppliers.write', 'delete', 'users.manage'],
  Operations: ['assets.create', 'assets.update', 'movements.create', 'customers.write', 'locations.write', 'parts.write', 'suppliers.write'],
  Warehouse: ['assets.create', 'assets.update', 'movements.create', 'locations.write', 'suppliers.write'],
  Service: ['assets.update', 'movements.create', 'parts.write'],
  'Account Manager': ['customers.write'],
  Management: [],
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  Admin: 'Akses penuh: semua data, hapus data, dan kelola akun user.',
  Operations: 'Penerimaan & registrasi aset, pergerakan EDC, master customer, merchant, supplier, dan part.',
  Warehouse: 'Penerimaan & registrasi aset, pergerakan EDC, master lokasi dan supplier.',
  Service: 'Update aset, pergerakan (perbaikan/penarikan), dan master part.',
  'Account Manager': 'Kelola master customer. Data lain hanya baca.',
  Management: 'Hanya baca: dashboard, monitoring aset, dan kontrak.',
};

export const can = (role: string | null | undefined, permission: Permission) =>
  !!role && (PERMISSIONS[role as Role] || []).includes(permission);
