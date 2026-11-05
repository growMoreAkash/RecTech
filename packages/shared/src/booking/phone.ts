/**
 * Phone numbers are the guest identity (no faces, no accounts). Stored as E.164.
 * Indian numbers may be typed as 10 digits, 0XXXXXXXXXX or +91…; others must include +country code.
 */
export function normalizePhone(input: string, defaultCountry = '91'): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const plus = raw.startsWith('+') || raw.startsWith('00');
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);
  if (!plus) {
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 12 && digits.startsWith(defaultCountry))
      digits = digits.slice(defaultCountry.length);
    if (digits.length !== 10) return null;
    digits = defaultCountry + digits;
  }
  if (digits.startsWith('91')) {
    // Indian mobiles: 10 digits starting 6–9.
    return /^91[6-9]\d{9}$/.test(digits) ? `+${digits}` : null;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

/** "+91 ••••••4210": enough for staff to confirm the person without showing the whole number. */
export function maskPhone(e164: string): string {
  const cc = e164.startsWith('+91') ? '+91' : e164.slice(0, Math.max(2, e164.length - 10));
  return `${cc} ••••••${e164.slice(-4)}`;
}
