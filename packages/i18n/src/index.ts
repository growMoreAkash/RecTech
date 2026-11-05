import en from '../messages/en.json';
import hi from '../messages/hi.json';

export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export type Messages = typeof en;
export const messages: Record<Locale, Messages> = { en, hi };

/** Flatten nested catalog keys: { a: { b: 'x' } } → ['a.b']. */
export function flattenKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? flattenKeys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
