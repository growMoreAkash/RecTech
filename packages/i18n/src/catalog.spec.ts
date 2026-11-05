import { describe, expect, it } from 'vitest';
import { flattenKeys, LOCALES, messages } from './index';
import { TABLE_STATUSES, VEG_TYPES } from '@dinesense/shared';

describe('i18n catalogs', () => {
  const enKeys = flattenKeys(messages.en).sort();

  it.each(LOCALES)('%s has exactly the same keys as en', (locale) => {
    expect(flattenKeys(messages[locale]).sort()).toEqual(enKeys);
  });

  it('has a label for every table status and veg type', () => {
    for (const s of TABLE_STATUSES) expect(enKeys).toContain(`tableStatus.${s}`);
    for (const v of VEG_TYPES) expect(enKeys).toContain(`vegType.${v}`);
  });
});
