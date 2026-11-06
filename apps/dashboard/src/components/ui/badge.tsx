import type { TableStatus } from '@dinesense/shared';
import { useTranslations } from 'next-intl';
import { STATUS_STYLE } from '@/lib/floor-style';

export function StatusBadge({ status }: { status: TableStatus }) {
  const t = useTranslations('tableStatus');
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ background: s.fill, borderColor: s.stroke, color: s.text }}
    >
      <span aria-hidden>{s.glyph}</span>
      {t(status)}
    </span>
  );
}
