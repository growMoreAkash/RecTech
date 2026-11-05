import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** Re-renders every `ms` and returns the current time (for live timers). */
export { useNow } from './use-now';

/** String value of a form field ('' for missing or file fields). */
export function formText(data: FormData, name: string): string {
  const v = data.get(name);
  return typeof v === 'string' ? v : '';
}
