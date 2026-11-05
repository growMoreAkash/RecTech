import { applyBps, gstForLine, roundHalfUp, roundOffToRupee } from './money';

/**
 * GST bill computation for restaurant invoices (pure, integer paise).
 *
 * Order of operations per line:
 *   1. exclusive value = qty × unit price (or the tax-exclusive part when menu prices include GST)
 *   2. minus its share of the bill discount (allocated pro rata, exact to the paisa)
 *   3. service charge = % of the discounted value (it is part of the taxable supply, so it is taxed too)
 *   4. GST per rate, on the rate's total taxable value (items + service charge), split CGST = SGST,
 *      then distributed back to the lines pro rata (exact)
 * The total is rounded to the nearest rupee and the difference is shown as round-off.
 */

export interface BillInputLine {
  key: string;
  quantity: number;
  unitPricePaise: number;
  taxRateBps: number;
}

export interface BillOptions {
  discountPaise: number;
  serviceChargeBps: number;
  pricesIncludeTax: boolean;
}

export interface BillLineResult {
  key: string;
  quantity: number;
  unitPricePaise: number;
  taxRateBps: number;
  /** Tax-exclusive value before discount. */
  valuePaise: number;
  discountPaise: number;
  /** Discounted value of the item itself (the invoice line's taxable value). */
  taxableValuePaise: number;
  serviceChargePaise: number;
  /** GST on the item (taxable value). */
  cgstPaise: number;
  sgstPaise: number;
  /** GST on this line's share of the service charge. */
  serviceChargeCgstPaise: number;
  serviceChargeSgstPaise: number;
}

export interface BillResult {
  lines: BillLineResult[];
  subtotalPaise: number;
  discountPaise: number;
  serviceChargePaise: number;
  /** Taxable value of the whole invoice: discounted items + service charge. */
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  /** GST summary by rate, as printed on the invoice. */
  taxByRate: { taxRateBps: number; taxablePaise: number; cgstPaise: number; sgstPaise: number }[];
  roundOffPaise: number;
  totalPaise: number;
}

export class BillError extends Error {
  constructor(
    readonly code: 'DISCOUNT_TOO_LARGE' | 'INVALID_INPUT',
    message: string,
  ) {
    super(message);
  }
}

/** Splits `amount` across `weights` pro rata so the parts sum exactly (largest remainder). */
export function allocate(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const parts = raw.map(Math.floor);
  let left = amount - parts.reduce((s, p) => s + p, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    parts[i]! += 1;
    left -= 1;
  }
  return parts;
}

export function computeBill(input: readonly BillInputLine[], opts: BillOptions): BillResult {
  for (const l of input) {
    if (
      !Number.isInteger(l.quantity) ||
      l.quantity <= 0 ||
      !Number.isInteger(l.unitPricePaise) ||
      l.unitPricePaise < 0
    ) {
      throw new BillError('INVALID_INPUT', `Invalid bill line ${l.key}`);
    }
  }
  if (!Number.isInteger(opts.discountPaise) || opts.discountPaise < 0)
    throw new BillError('INVALID_INPUT', 'Invalid discount');

  const values = input.map((l) => {
    const gross = l.unitPricePaise * l.quantity;
    // Tax-inclusive menu: back out the GST so tax is computed on the exclusive value.
    return opts.pricesIncludeTax ? roundHalfUp((gross * 10_000) / (10_000 + l.taxRateBps)) : gross;
  });
  const subtotalPaise = values.reduce((s, v) => s + v, 0);
  if (opts.discountPaise > subtotalPaise)
    throw new BillError('DISCOUNT_TOO_LARGE', 'Discount exceeds the bill');
  const discounts = allocate(opts.discountPaise, values);

  const lines: BillLineResult[] = input.map((l, i) => {
    const taxable = values[i]! - discounts[i]!;
    return {
      key: l.key,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      taxRateBps: l.taxRateBps,
      valuePaise: values[i]!,
      discountPaise: discounts[i]!,
      taxableValuePaise: taxable,
      serviceChargePaise: applyBps(taxable, opts.serviceChargeBps),
      cgstPaise: 0,
      sgstPaise: 0,
      serviceChargeCgstPaise: 0,
      serviceChargeSgstPaise: 0,
    };
  });

  // GST per rate on the rate's total taxable value — so the invoice's "CGST @ 2.5% on ₹X" line is exact —
  // then distributed back to each line's item and service-charge parts (they sum exactly).
  const rates = [...new Set(lines.map((l) => l.taxRateBps))].sort((a, b) => a - b);
  const taxByRate = rates.map((taxRateBps) => {
    const group = lines.filter((l) => l.taxRateBps === taxRateBps);
    const parts = group.flatMap((l) => [l.taxableValuePaise, l.serviceChargePaise]);
    const taxablePaise = parts.reduce((s, v) => s + v, 0);
    const half = gstForLine(taxablePaise, taxRateBps).cgstPaise;
    const shares = allocate(half, parts);
    group.forEach((l, k) => {
      l.cgstPaise = l.sgstPaise = shares[2 * k]!;
      l.serviceChargeCgstPaise = l.serviceChargeSgstPaise = shares[2 * k + 1]!;
    });
    return { taxRateBps, taxablePaise, cgstPaise: half, sgstPaise: half };
  });
  const serviceChargePaise = lines.reduce((s, l) => s + l.serviceChargePaise, 0);
  const taxablePaise = taxByRate.reduce((s, r) => s + r.taxablePaise, 0);
  const cgstPaise = taxByRate.reduce((s, r) => s + r.cgstPaise, 0);
  const sgstPaise = taxByRate.reduce((s, r) => s + r.sgstPaise, 0);
  const { roundedPaise, roundOffPaise } = roundOffToRupee(taxablePaise + cgstPaise + sgstPaise);

  return {
    lines,
    subtotalPaise,
    discountPaise: opts.discountPaise,
    serviceChargePaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    taxByRate,
    roundOffPaise,
    totalPaise: roundedPaise,
  };
}
