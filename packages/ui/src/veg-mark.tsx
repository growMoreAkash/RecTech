import { useTranslations } from 'next-intl';

/**
 * FSSAI-style diet mark: green square with a dot (veg), brown square with a triangle (non-veg), yellow for egg.
 * Always paired with an accessible label.
 */
export function VegMark({ vegType, size = 16 }: { vegType: string; size?: number }) {
  const t = useTranslations('vegType');
  const color = vegType === 'VEG' ? '#15803d' : vegType === 'EGG' ? '#ca8a04' : '#92400e';
  const label = t.has(vegType) ? t(vegType as 'VEG') : vegType;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label} className="shrink-0">
      <title>{label}</title>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#fff" stroke={color} strokeWidth="1.6" />
      {vegType === 'VEG' ? (
        <circle cx="8" cy="8" r="3.6" fill={color} />
      ) : (
        <path d="M8 4 L12 11.5 H4 Z" fill={color} />
      )}
    </svg>
  );
}
