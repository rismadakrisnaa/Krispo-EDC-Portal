import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { addMonths } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Calculates the current effective ending date based on ARO (Automatic Renewal)
 * @param expectedEndDateStr The original expected end date from DB
 * @param renewalMonths Months to add for each ARO cycle (default 12 months)
 * @returns Date object representing the current cycle's end date
 */
export function getAROExpectedEnd(expectedEndDateStr: string | undefined, renewalMonths: number = 12): Date | null {
  if (!expectedEndDateStr) return null;
  
  const originalEnd = new Date(expectedEndDateStr);
  const now = new Date();
  
  if (now <= originalEnd) return originalEnd;
  
  let effectiveEnd = originalEnd;
  while (now > effectiveEnd) {
    effectiveEnd = addMonths(effectiveEnd, renewalMonths);
  }
  return effectiveEnd;
}
