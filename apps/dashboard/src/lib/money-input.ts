/** "340" / "340.5" / "₹1,340.50" → paise, parsed as text (no float maths). Returns null if invalid. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[₹,\s]/g, '');
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** 34050 → "340.50" for an input field. */
export const paiseToRupees = (paise: number) =>
  `${Math.trunc(paise / 100)}.${String(Math.abs(paise) % 100).padStart(2, '0')}`;
