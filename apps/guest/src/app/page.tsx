import { getTranslations } from 'next-intl/server';

/** Guests always arrive via a table QR (/t/{token}); this is only a friendly fallback. */
export default async function Home() {
  const t = await getTranslations('guest');
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <p className="max-w-xs text-lg">{t('scanQr')}</p>
    </main>
  );
}
