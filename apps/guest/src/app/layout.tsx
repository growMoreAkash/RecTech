import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'DineSense',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#c2410c' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={await getLocale()}>
      <body>
        <NextIntlClientProvider messages={await getMessages()} timeZone="Asia/Kolkata">
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
