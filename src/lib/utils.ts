import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';
import { STOCK_STATUSES } from './constants';
import type { Asset } from './types';

export { getAROExpectedEnd } from './contract';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatIDR = (value: unknown) => `Rp ${Number(value || 0).toLocaleString('id-ID')}`;

/** Format tanggal yang aman: menerima ISO string, Date, atau Firestore Timestamp. Tidak pernah throw. */
export function formatDate(value: any, pattern = 'dd MMM yyyy'): string {
  if (!value) return '-';
  try {
    const date: Date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    if (isNaN(date.getTime())) return '-';
    return format(date, pattern);
  } catch {
    return '-';
  }
}

/** Pencarian case-insensitive yang aman terhadap field kosong / undefined. */
export function matchesSearch(term: string, ...fields: unknown[]): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return fields.some(f => f != null && String(f).toLowerCase().includes(needle));
}

/** Satu definisi untuk teks lokasi aset, dipakai di semua halaman & export. */
export function locationLabel(asset: Pick<Asset, 'locationName' | 'status' | 'customerName'>): string {
  if (asset.locationName) return asset.locationName;
  if (STOCK_STATUSES.includes(asset.status)) return 'Gudang';
  return asset.customerName ? `Lokasi ${asset.customerName}` : '-';
}

/** Nilai numerik dari input form / Excel. Selalu mengembalikan angka >= 0. */
export function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Buang key bernilai undefined supaya aman dikirim ke Firestore. */
export function stripUndefined<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Ringkasan data tambahan sebuah log pergerakan untuk ditampilkan di riwayat. */
export function movementDetailText(m: {
  type?: string; referenceNo?: string; courier?: string; serviceVendor?: string; cost?: number; supplierName?: string; poNumber?: string;
  swapWithSn?: string; conditionAfter?: string; disposalMethod?: string; disposalValue?: number; tid?: string; mid?: string;
}): string {
  const parts: string[] = [];
  if (m.type === 'Swap Out' && m.swapWithSn) parts.push(`Diganti ${m.swapWithSn}`);
  if (m.type === 'Swap In' && m.swapWithSn) parts.push(`Menggantikan ${m.swapWithSn}`);
  if (m.supplierName) parts.push(`Supplier ${m.supplierName}`);
  if (m.poNumber) parts.push(`PO ${m.poNumber}`);
  if (m.referenceNo) parts.push(`Ref ${m.referenceNo}`);
  if (m.courier) parts.push(m.courier);
  if (m.serviceVendor) parts.push(m.serviceVendor);
  if (m.type === 'Staging' && (m.tid || m.mid)) parts.push(`TID ${m.tid || '-'} / MID ${m.mid || '-'}`);
  if (m.conditionAfter) parts.push(`Kondisi ${m.conditionAfter}`);
  if (m.disposalMethod) parts.push(m.disposalMethod);
  if (m.disposalValue) parts.push(`Nilai ${formatIDR(m.disposalValue)}`);
  if (m.cost) parts.push(`${m.type === 'Goods Receipt' ? 'Harga' : 'Biaya'} ${formatIDR(m.cost)}`);
  return parts.join(' · ');
}

/** Selisih hari utuh antara dua tanggal (ISO / Date / Timestamp). */
export function daysBetween(from: any, to: any = new Date()): number | null {
  const toDate = (v: any) => (typeof v?.toDate === 'function' ? v.toDate() : new Date(v));
  if (!from) return null;
  const a = toDate(from);
  const b = toDate(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86_400_000));
}

/** "45 hari", "3 bln", "2,1 thn". */
export function formatDuration(days: number | null | undefined): string {
  if (days == null) return '-';
  if (days < 60) return `${days} hari`;
  if (days < 730) return `${Math.round(days / 30)} bln`;
  return `${(days / 365).toFixed(1).replace('.', ',')} thn`;
}

/** Link Google Maps dari koordinat, atau dari alamat jika koordinat kosong. */
export function mapsUrl(l: { latitude?: number | null; longitude?: number | null; address?: string; city?: string }) {
  if (l.latitude != null && l.longitude != null) return `https://www.google.com/maps?q=${l.latitude},${l.longitude}`;
  const q = [l.address, l.city].filter(Boolean).join(', ');
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}
