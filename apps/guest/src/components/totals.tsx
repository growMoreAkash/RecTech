import { Money } from '@dinesense/ui/money';
import { useTranslations } from 'next-intl';
import type { Totals as T } from '@/lib/types';

export function Totals({ totals }: { totals: T }) {
  const t = useTranslations('guest');
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex justify-between">
        <dt>{t('subtotal')}</dt>
        <dd>
          <Money paise={totals.subtotalPaise} />
        </dd>
      </div>
      <div className="flex justify-between text-slate-600">
        <dt>{t('cgst')}</dt>
        <dd>
          <Money paise={totals.cgstPaise} />
        </dd>
      </div>
      <div className="flex justify-between text-slate-600">
        <dt>{t('sgst')}</dt>
        <dd>
          <Money paise={totals.sgstPaise} />
        </dd>
      </div>
      <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
        <dt>{t('total')}</dt>
        <dd>
          <Money paise={totals.totalPaise} />
        </dd>
      </div>
    </dl>
  );
}
