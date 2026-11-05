import type { TableStatus } from '@dinesense/shared';
import { useTranslations } from 'next-intl';

const TONE: Record<TableStatus, string> = {
  VACANT: 'bg-slate-100 text-slate-700',
  RESERVED: 'bg-violet-100 text-violet-800',
  OCCUPIED: 'bg-blue-100 text-blue-800',
  GREETED: 'bg-cyan-100 text-cyan-800',
  ORDERED: 'bg-yellow-100 text-yellow-800',
  SERVED: 'bg-green-100 text-green-800',
  BILL_REQUESTED: 'bg-orange-100 text-orange-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  NEEDS_CLEANING: 'bg-red-100 text-red-800',
  OUT_OF_SERVICE: 'bg-slate-200 text-slate-600',
};

export function StatusChip({ status }: { status: TableStatus }) {
  const t = useTranslations('tableStatus');
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[status]}`}>{t(status)}</span>;
}
