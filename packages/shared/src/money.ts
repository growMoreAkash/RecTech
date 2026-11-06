/**
 * Money is integer paise; tax rates are integer basis points (500 = 5%).
 * GST on restaurant service is split equally into CGST and SGST (intra-state).
 */

/** Round half away from zero to an integer (for non-negative money this is round-half-up). */
export function roundHalfUp(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** amount * bps / 10000, rounded half-up. Uses integer math where possible to avoid FP drift. */
export function applyBps(amountPaise: number, bps: number): number {
  assertInt(amountPaise, 'amountPaise');
  assertInt(bps, 'bps');
  return roundHalfUp((amountPaise * bps) / 10_000);
}

export interface GstLine {
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalTaxPaise: number;
  grossPaise: number;
}

/**
 * Tax for one invoice line. Each half (CGST, SGST) is rounded separately so that
 * CGST === SGST always holds, as printed on Indian GST invoices.
 */
export function gstForLine(taxableValuePaise: number, taxRateBps: number): GstLine {
  assertInt(taxableValuePaise, 'taxableValuePaise');
  assertInt(taxRateBps, 'taxRateBps');
  if (taxableValuePaise < 0) throw new RangeError('taxableValuePaise must be >= 0');
  const half = roundHalfUp((taxableValuePaise * taxRateBps) / 20_000);
  return {
    taxableValuePaise,
    cgstPaise: half,
    sgstPaise: half,
    totalTaxPaise: half * 2,
    grossPaise: taxableValuePaise + half * 2,
  };
}

/** Round a bill total to the nearest rupee; returns the round-off adjustment in paise (may be negative). */
export function roundOffToRupee(totalPaise: number): { roundedPaise: number; roundOffPaise: number } {
  assertInt(totalPaise, 'totalPaise');
  const roundedPaise = roundHalfUp(totalPaise / 100) * 100;
  return { roundedPaise, roundOffPaise: roundedPaise - totalPaise };
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** 12345 → "₹123.45" (Indian digit grouping: ₹1,23,456.00). */
export function formatInr(paise: number): string {
  return inr.format(paise / 100);
}

/** Indian financial year label for a date, e.g. 2026-11-05 → "2026-27" (FY runs Apr–Mar, IST). */
export function financialYear(date: Date, timeZone = 'Asia/Kolkata'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function assertInt(n: number, name: string): void {
  if (!Number.isInteger(n)) throw new TypeError(`${name} must be an integer, got ${n}`);
}
