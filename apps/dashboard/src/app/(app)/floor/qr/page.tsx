'use client';

import { Button } from '@dinesense/ui/button';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useFloor } from '@/lib/queries';
import { useSession } from '@/lib/session';

const GUEST_URL = process.env.NEXT_PUBLIC_GUEST_URL ?? 'http://localhost:3001';

/** Printable sheet of table QR codes (one per table, static: /t/{qrToken}). */
export default function QrSheet() {
  const t = useTranslations('qr');
  const { outlet } = useSession();
  const floor = useFloor(outlet.id);
  const [codes, setCodes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!floor.data) return;
    let cancelled = false;
    void Promise.all(
      floor.data.tables.map(
        async (x) =>
          [
            x.id,
            await QRCode.toDataURL(`${GUEST_URL}/t/${x.qrToken}`, {
              margin: 1,
              width: 360,
              errorCorrectionLevel: 'M',
            }),
          ] as const,
      ),
    ).then((pairs) => !cancelled && setCodes(Object.fromEntries(pairs)));
    return () => {
      cancelled = true;
    };
  }, [floor.data]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-3 print:hidden">
        <h1 className="mr-auto text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => window.print()}>{t('print')}</Button>
      </div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
        {floor.data?.tables.map((x) => (
          <li
            key={x.id}
            className="break-inside-avoid rounded-xl border border-slate-300 bg-white p-4 text-center"
          >
            <p className="text-2xl font-bold">{x.label}</p>
            {codes[x.id] ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL generated locally
              <img
                src={codes[x.id]}
                alt={t('alt', { label: x.label })}
                className="mx-auto my-2 aspect-square w-full max-w-48"
              />
            ) : (
              <div className="mx-auto my-2 aspect-square w-full max-w-48 bg-slate-100" aria-busy="true" />
            )}
            <p className="text-sm">{t('scan')}</p>
            <p className="text-xs text-slate-500">{outlet.name}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
