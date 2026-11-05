import { formatInr } from '@dinesense/shared';
import type { BillingService } from './billing.service';

type InvoiceData = Awaited<ReturnType<BillingService['invoiceData']>>;

const esc = (v: string | number | null | undefined) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const inr = (p: number) => esc(formatInr(p));
const pct = (bps: number) => `${bps / 100}%`;

/**
 * Printable GST tax invoice (English: the legal document). Self-contained HTML, no external assets,
 * so it prints offline and can be shared as a link.
 */
export function renderInvoice(b: InvoiceData): string {
  const tz = b.outlet.timezone;
  const when = (d: Date | null) =>
    d
      ? esc(
          new Intl.DateTimeFormat('en-IN', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(
            d,
          ),
        )
      : '';
  const tables = b.seating.tables.map((t) => t.table.label).join(' + ');
  const breakup =
    (b.taxBreakup as { taxRateBps: number; taxablePaise: number; cgstPaise: number; sgstPaise: number }[]) ??
    [];
  const title =
    b.status === 'OPEN'
      ? 'PROVISIONAL BILL — NOT A TAX INVOICE'
      : b.status === 'VOID'
        ? 'CANCELLED TAX INVOICE'
        : 'TAX INVOICE';
  const paid = b.payments.filter((p) => p.status === 'CAPTURED');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(b.invoiceNumber ?? 'Bill')} — ${esc(b.outlet.name)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.4 system-ui, 'Noto Sans', sans-serif; color: #111; margin: 0; background: #f4f4f5; }
  main { max-width: 640px; margin: 16px auto; background: #fff; padding: 24px; border: 1px solid #ddd; }
  h1 { font-size: 18px; margin: 0; } h2 { font-size: 13px; letter-spacing: .08em; margin: 12px 0; text-align: center; }
  .muted { color: #555; font-size: 12px; } .row { display: flex; justify-content: space-between; gap: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-variant-numeric: tabular-nums; }
  th, td { padding: 6px 4px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  th { font-size: 12px; color: #444; } .r { text-align: right; } .total td { font-weight: 700; font-size: 16px; border-top: 2px solid #111; }
  .void { color: #b91c1c; } .actions { text-align: center; margin: 16px; }
  @media print { body { background: #fff; } main { border: 0; margin: 0; max-width: none; } .actions { display: none; } }
</style></head>
<body><main>
  <div class="row"><div>
    <h1>${esc(b.outlet.legalName ?? b.outlet.name)}</h1>
    <div class="muted">${esc(b.outlet.name)}</div>
    <div class="muted">${esc(b.outlet.address)}</div>
    ${b.outlet.gstin ? `<div class="muted">GSTIN: ${esc(b.outlet.gstin)}</div>` : ''}
  </div><div class="r">
    <div><strong>${esc(b.invoiceNumber ?? '—')}</strong></div>
    <div class="muted">${when(b.finalizedAt ?? b.createdAt)}</div>
    <div class="muted">Table ${esc(tables)}${b.seating.partySize ? ` · ${b.seating.partySize} guests` : ''}</div>
  </div></div>
  <h2 class="${b.status === 'VOID' ? 'void' : ''}">${title}</h2>
  ${b.status === 'VOID' ? `<p class="void">Cancelled: ${esc(b.voidReason)}</p>` : ''}
  <table>
    <thead><tr><th>Item</th><th>SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amount</th></tr></thead>
    <tbody>
      ${b.lines
        .map(
          (l) => `<tr><td>${esc(l.description)}</td><td>${esc(l.hsnSac)}</td><td class="r">${l.quantity}</td>
          <td class="r">${inr(l.unitPricePaise)}</td><td class="r">${pct(l.taxRateBps)}</td><td class="r">${inr(l.unitPricePaise * l.quantity)}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <table>
    <tbody>
      <tr><td>Subtotal</td><td class="r">${inr(b.subtotalPaise)}</td></tr>
      ${b.discountPaise ? `<tr><td>Discount${b.discountReason ? ` (${esc(b.discountReason)})` : ''}</td><td class="r">−${inr(b.discountPaise)}</td></tr>` : ''}
      ${b.serviceChargePaise ? `<tr><td>Service charge (${pct(b.serviceChargeBps)})</td><td class="r">${inr(b.serviceChargePaise)}</td></tr>` : ''}
      <tr><td>Taxable value</td><td class="r">${inr(b.taxablePaise)}</td></tr>
      ${breakup
        .map(
          (
            r,
          ) => `<tr><td>CGST @ ${pct(r.taxRateBps / 2)} on ${inr(r.taxablePaise)}</td><td class="r">${inr(r.cgstPaise)}</td></tr>
          <tr><td>SGST @ ${pct(r.taxRateBps / 2)} on ${inr(r.taxablePaise)}</td><td class="r">${inr(r.sgstPaise)}</td></tr>`,
        )
        .join('')}
      ${b.roundOffPaise ? `<tr><td>Round off</td><td class="r">${b.roundOffPaise > 0 ? '' : '−'}${inr(Math.abs(b.roundOffPaise))}</td></tr>` : ''}
      <tr class="total"><td>Total</td><td class="r">${inr(b.totalPaise)}</td></tr>
      ${paid.map((p) => `<tr><td class="muted">Paid · ${esc(p.method)}${p.reference ? ` · ${esc(p.reference)}` : ''}</td><td class="r muted">${inr(p.amountPaise)}</td></tr>`).join('')}
    </tbody>
  </table>
  <p class="muted">Restaurant service · SAC 996331. Prices in INR. Thank you for dining with us.</p>
</main>
<div class="actions"><button onclick="window.print()">Print</button></div>
</body></html>`;
}
