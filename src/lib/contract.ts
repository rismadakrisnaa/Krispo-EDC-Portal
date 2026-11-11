import { addMonths, differenceInMonths } from 'date-fns';
import { ARO_RENEWAL_MONTHS, CONTRACT_STATUS, DEFAULT_CONTRACT_MONTHS } from './constants';
import type { Asset, Customer } from './types';

/**
 * Logika kontrak & denda per unit. Semua fungsi di file ini murni (tanpa akses DB)
 * supaya bisa diuji dan dipakai konsisten di Pergerakan, Monitoring Kontrak, dan Dashboard.
 */

/**
 * Tanggal akhir kontrak yang berlaku saat `now`, dengan ARO (perpanjangan otomatis).
 * Jika kontrak sudah lewat tanggal akhir aslinya, akhir kontrak digeser per `renewalMonths`.
 */
export function getAROExpectedEnd(
  expectedEndDateStr: string | undefined,
  renewalMonths: number = ARO_RENEWAL_MONTHS,
  now: Date = new Date(),
): Date | null {
  if (!expectedEndDateStr) return null;
  const originalEnd = new Date(expectedEndDateStr);
  if (isNaN(originalEnd.getTime())) return null;

  let effectiveEnd = originalEnd;
  let guard = 0;
  while (now > effectiveEnd && guard++ < 1200) {
    effectiveEnd = addMonths(effectiveEnd, renewalMonths);
  }
  return effectiveEnd;
}

/** Sisa bulan kontrak, dibulatkan ke atas (sisa 1 hari tetap dihitung 1 bulan). */
export function remainingContractMonths(from: Date, end: Date): number {
  if (from >= end) return 0;
  const full = differenceInMonths(end, from);
  return addMonths(from, full) < end ? full + 1 : full;
}

/** Field kontrak yang ditulis ke unit saat Install. */
export function buildInstallContract(customer: Customer, startDate: Date) {
  const duration = Number(customer.contractDuration) > 0 ? Number(customer.contractDuration) : DEFAULT_CONTRACT_MONTHS;
  return {
    contractStartDate: startDate.toISOString(),
    expectedEndDate: addMonths(startDate, duration).toISOString(),
    contractStatus: CONTRACT_STATUS.ACTIVE,
    contractScheme: customer.scheme || 'Sewa',
    contractCustomerId: customer.id,
    contractCustomerName: customer.name,
    currentMonthlyRental: Number(customer.value) || 0,
    penaltyAmount: 0,
    partPenaltyAmount: 0,
  };
}

export interface TerminationResult {
  contractStatus: string;
  contractEndDateActual: string;
  penaltyAmount: number;
  remainingMonthsAtTermination: number;
  isTerminatedInARO: boolean;
}

/**
 * Hitung pengakhiran kontrak saat unit ditarik pada `terminationDate`.
 * Mengembalikan null jika unit tidak punya kontrak aktif.
 * Denda early termination = sisa bulan (dibulatkan ke atas) x sewa per bulan,
 * berlaku juga di masa ARO.
 */
export function calcTermination(
  asset: Pick<Asset, 'contractStatus' | 'expectedEndDate' | 'currentMonthlyRental'>,
  terminationDate: Date,
): TerminationResult | null {
  if (asset.contractStatus !== CONTRACT_STATUS.ACTIVE || !asset.expectedEndDate) return null;

  const originalEnd = new Date(asset.expectedEndDate);
  const effectiveEnd = getAROExpectedEnd(asset.expectedEndDate, ARO_RENEWAL_MONTHS, terminationDate) || originalEnd;
  const remaining = remainingContractMonths(terminationDate, effectiveEnd);
  const isEarly = remaining > 0;

  return {
    contractStatus: isEarly ? CONTRACT_STATUS.TERMINATED_EARLY : CONTRACT_STATUS.TERMINATED_NORMAL,
    contractEndDateActual: terminationDate.toISOString(),
    penaltyAmount: isEarly ? remaining * (Number(asset.currentMonthlyRental) || 0) : 0,
    remainingMonthsAtTermination: remaining,
    isTerminatedInARO: effectiveEnd.getTime() > originalEnd.getTime(),
  };
}

export type ContractHealth = 'active' | 'ending' | 'aro' | 'terminated' | 'none';

/** Ringkasan kondisi kontrak sebuah unit untuk badge, filter, dan dashboard. */
export function contractHealth(asset: Pick<Asset, 'contractStatus' | 'expectedEndDate'>, now: Date = new Date()) {
  if (!asset.contractStatus) return { health: 'none' as ContractHealth, effectiveEnd: null, isARO: false, daysLeft: 0 };

  const effectiveEnd = getAROExpectedEnd(asset.expectedEndDate, ARO_RENEWAL_MONTHS, now);
  const isARO = !!effectiveEnd && !!asset.expectedEndDate && effectiveEnd.getTime() > new Date(asset.expectedEndDate).getTime();
  const daysLeft = effectiveEnd ? Math.ceil((effectiveEnd.getTime() - now.getTime()) / 86_400_000) : 0;

  let health: ContractHealth = 'active';
  if (asset.contractStatus !== CONTRACT_STATUS.ACTIVE) health = 'terminated';
  else if (daysLeft <= 30) health = 'ending';
  else if (isARO) health = 'aro';

  return { health, effectiveEnd, isARO, daysLeft };
}
