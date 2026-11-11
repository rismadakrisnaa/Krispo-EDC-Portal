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
