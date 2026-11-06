import { DEFAULT_LOCALE, LOCALES, type Locale, messages } from '@dinesense/i18n';
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

export const LOCALE_COOKIE = 'ds.locale';

/** Locale comes from a cookie (no locale in URLs for a staff tool). */
export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = (LOCALES as readonly string[]).includes(value ?? '')
    ? (value as Locale)
    : DEFAULT_LOCALE;
  return { locale, messages: messages[locale], timeZone: 'Asia/Kolkata' };
});
