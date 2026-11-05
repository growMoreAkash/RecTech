export { cn } from '@dinesense/ui/cn';

/** Re-renders every `ms` and returns the current time (for live timers). */
export { useNow } from './use-now';

/** String value of a form field ('' for missing or file fields). */
export function formText(data: FormData, name: string): string {
  const v = data.get(name);
  return typeof v === 'string' ? v : '';
}
