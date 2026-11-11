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
  RESERVED: 'Reserved / Allocated',
  IN_DELIVERY: 'In Delivery',
  INSTALLED: 'Installed / Active',
  WITHDRAWN: 'Withdrawn',
  REPAIR: 'Under Repair',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  RETIRED: 'Retired',
} as const;

export type AssetStatus = (typeof STATUS)[keyof typeof STATUS];

export const ALL_STATUSES: AssetStatus[] = Object.values(STATUS);

export const STATUS_META: Record<string, { label: string; badge: string; chart: string }> = {
  [STATUS.INCOMING]: { label: 'Stok Masuk', badge: 'bg-sky-50 text-sky-700 border-sky-200', chart: '#0EA5E9' },
  [STATUS.AVAILABLE]: { label: 'Tersedia', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', chart: '#10B981' },
  [STATUS.RESERVED]: { label: 'Dialokasikan', badge: 'bg-violet-50 text-violet-700 border-violet-200', chart: '#8B5CF6' },
  [STATUS.IN_DELIVERY]: { label: 'Dalam Pengiriman', badge: 'bg-amber-50 text-amber-700 border-amber-200', chart: '#F59E0B' },
  [STATUS.INSTALLED]: { label: 'Terpasang', badge: 'bg-blue-50 text-blue-700 border-blue-200', chart: '#3B82F6' },
  [STATUS.WITHDRAWN]: { label: 'Ditarik (Gudang)', badge: 'bg-teal-50 text-teal-700 border-teal-200', chart: '#14B8A6' },
  [STATUS.REPAIR]: { label: 'Perbaikan', badge: 'bg-orange-50 text-orange-700 border-orange-200', chart: '#F97316' },
  [STATUS.DAMAGED]: { label: 'Rusak', badge: 'bg-red-50 text-red-700 border-red-200', chart: '#EF4444' },
  [STATUS.LOST]: { label: 'Hilang', badge: 'bg-rose-50 text-rose-700 border-rose-200', chart: '#E11D48' },
  [STATUS.RETIRED]: { label: 'Dihapuskan', badge: 'bg-gray-100 text-gray-600 border-gray-300', chart: '#6B7280' },
};

export const statusMeta = (status?: string) =>
  STATUS_META[status || ''] || { label: status || 'Tanpa Status', badge: 'bg-gray-50 text-gray-700 border-gray-200', chart: '#94A3B8' };

/** Status yang dihitung sebagai stok siap pakai di gudang. */
export const STOCK_STATUSES: string[] = [STATUS.AVAILABLE, STATUS.WITHDRAWN];
/** Status di mana aset sedang dipegang / disiapkan untuk customer. */
export const CUSTOMER_STATUSES: string[] = [STATUS.RESERVED, STATUS.IN_DELIVERY, STATUS.INSTALLED];
/** Status di mana unit sudah dipesan / dalam perjalanan ke customer. */
export const TRANSIT_STATUSES: string[] = [STATUS.RESERVED, STATUS.IN_DELIVERY];
/** Status bermasalah yang butuh tindak lanjut. */
export const PROBLEM_STATUSES: string[] = [STATUS.REPAIR, STATUS.DAMAGED, STATUS.LOST];

/**
 * Grup status untuk filter. Dashboard dan menu Aset memakai definisi yang sama,
 * sehingga angka di kartu dashboard selalu cocok dengan daftar yang dibuka.
 */
export const STATUS_GROUPS: Record<string, { label: string; statuses: string[] }> = {
  stock: { label: 'Stok gudang (siap pakai)', statuses: STOCK_STATUSES },
  customer: { label: 'Di customer (alokasi, kirim, terpasang)', statuses: CUSTOMER_STATUSES },
  transit: { label: 'Alokasi / dalam pengiriman', statuses: TRANSIT_STATUSES },
  problem: { label: 'Perbaikan / rusak / hilang', statuses: PROBLEM_STATUSES },
};

export const matchesStatusFilter = (filter: string, status: string) =>
  !filter || filter === 'All' || (STATUS_GROUPS[filter] ? STATUS_GROUPS[filter].statuses.includes(status) : status === filter);

/** Status awal yang boleh dipilih saat registrasi / import aset. */
export const INITIAL_STATUSES: string[] = [STATUS.AVAILABLE, STATUS.INCOMING];

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
// Pergerakan (lifecycle)
// ---------------------------------------------------------------------------
export type MovementType =
  | 'Allocation'
  | 'Delivery'
  | 'Install'
  | 'Relocation'
  | 'Withdrawal'
  | 'Repair'
  | 'Return to Stock'
  | 'Write-off';

export type LocationType = 'Warehouse' | 'Merchant Site' | 'Service Center';
export const LOCATION_TYPES: LocationType[] = ['Warehouse', 'Merchant Site', 'Service Center'];

export interface MovementRule {
  type: MovementType;
  label: string;
  description: string;
  /** Status asal yang diizinkan. */
  from: string[];
  /** Status tujuan. Lebih dari satu = user memilih. */
  to: string[];
  /** required: wajib pilih customer; keep: pakai customer yang sedang memegang unit; clear: lepas dari customer. */
  customer: 'required' | 'keep' | 'clear';
  /** Tipe lokasi tujuan. null = lokasi tidak berubah. */
  locationType: LocationType | null;
  /** Apakah Berita Acara (PDF) diterbitkan untuk pergerakan ini. */
  ba: boolean;
}

export const MOVEMENT_RULES: MovementRule[] = [
  {
    type: 'Allocation',
    label: 'Alokasi ke Customer',
    description: 'Booking unit gudang untuk customer tertentu. Unit belum keluar gudang.',
    from: [STATUS.AVAILABLE, STATUS.WITHDRAWN],
    to: [STATUS.RESERVED],
    customer: 'required',
    locationType: null,
    ba: false,
  },
  {
    type: 'Delivery',
    label: 'Kirim ke Merchant',
    description: 'Unit keluar gudang menuju lokasi customer.',
    from: [STATUS.AVAILABLE, STATUS.WITHDRAWN, STATUS.RESERVED],
    to: [STATUS.IN_DELIVERY],
    customer: 'required',
    locationType: 'Merchant Site',
    ba: true,
  },
  {
    type: 'Install',
    label: 'Pasang (Install)',
    description: 'Unit terpasang di merchant. Kontrak sewa per unit mulai berjalan dari tanggal transaksi.',
    from: [STATUS.AVAILABLE, STATUS.WITHDRAWN, STATUS.RESERVED, STATUS.IN_DELIVERY],
    to: [STATUS.INSTALLED],
    customer: 'required',
    locationType: 'Merchant Site',
    ba: true,
  },
  {
    type: 'Relocation',
    label: 'Relokasi',
    description: 'Pindah lokasi pemasangan di customer yang sama. Kontrak tidak berubah.',
    from: [STATUS.INSTALLED],
    to: [STATUS.INSTALLED],
    customer: 'keep',
    locationType: 'Merchant Site',
    ba: true,
  },
  {
    type: 'Withdrawal',
    label: 'Tarik (Withdrawal)',
    description: 'Unit ditarik dari merchant. Kontrak diakhiri dan denda dihitung otomatis.',
    from: [STATUS.INSTALLED],
    to: [STATUS.WITHDRAWN],
    customer: 'clear',
    locationType: 'Warehouse',
    ba: true,
  },
  {
    type: 'Repair',
    label: 'Kirim Perbaikan',
    description: 'Unit gudang dikirim ke service center.',
    from: [STATUS.AVAILABLE, STATUS.WITHDRAWN, STATUS.INCOMING, STATUS.DAMAGED],
    to: [STATUS.REPAIR],
    customer: 'clear',
    locationType: 'Service Center',
    ba: false,
  },
  {
    type: 'Return to Stock',
    label: 'Kembali ke Stok',
    description: 'Unit diterima / kembali menjadi stok siap pakai (stok masuk, batal alokasi, selesai perbaikan).',
    from: [STATUS.INCOMING, STATUS.WITHDRAWN, STATUS.RESERVED, STATUS.IN_DELIVERY, STATUS.REPAIR, STATUS.DAMAGED],
    to: [STATUS.AVAILABLE],
    customer: 'clear',
    locationType: 'Warehouse',
    ba: false,
  },
  {
    type: 'Write-off',
    label: 'Rusak / Hilang / Hapus',
    description: 'Unit tidak bisa dipakai lagi. Untuk unit terpasang, lakukan Tarik lebih dulu.',
    from: [STATUS.INCOMING, STATUS.AVAILABLE, STATUS.WITHDRAWN, STATUS.RESERVED, STATUS.IN_DELIVERY, STATUS.REPAIR, STATUS.DAMAGED],
    to: [STATUS.DAMAGED, STATUS.LOST, STATUS.RETIRED],
    customer: 'clear',
    locationType: null,
    ba: false,
  },
];

export const movementRule = (type: string) => MOVEMENT_RULES.find(r => r.type === type);

/** Label tampilan untuk tipe pergerakan, termasuk tipe sistem & data lama. */
export const movementLabel = (type?: string) => {
  const rule = movementRule(type || '');
  if (rule) return rule.label;
  if (!type) return 'Update';
  if (type.startsWith('Initial stock')) return type.includes('Import') ? 'Registrasi (Import)' : 'Registrasi Aset';
  if (type.startsWith('Cancel Termination')) return 'Batal Pengakhiran Kontrak';
  return type;
};

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
  | 'delete'
  | 'users.manage';

const PERMISSIONS: Record<Role, Permission[]> = {
  Admin: ['assets.create', 'assets.update', 'movements.create', 'customers.write', 'locations.write', 'parts.write', 'delete', 'users.manage'],
  Operations: ['assets.create', 'assets.update', 'movements.create', 'customers.write', 'locations.write', 'parts.write'],
  Warehouse: ['assets.create', 'assets.update', 'movements.create', 'locations.write'],
  Service: ['assets.update', 'movements.create', 'parts.write'],
  'Account Manager': ['customers.write'],
  Management: [],
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  Admin: 'Akses penuh: semua data, hapus data, dan kelola akun user.',
  Operations: 'Registrasi aset, pergerakan EDC, master customer, lokasi, dan part.',
  Warehouse: 'Registrasi aset, pergerakan EDC, dan master lokasi.',
  Service: 'Update aset, pergerakan (perbaikan/penarikan), dan master part.',
  'Account Manager': 'Kelola master customer. Data lain hanya baca.',
  Management: 'Hanya baca: dashboard, monitoring aset, dan kontrak.',
};

export const can = (role: string | null | undefined, permission: Permission) =>
  !!role && (PERMISSIONS[role as Role] || []).includes(permission);
