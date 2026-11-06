import { describe, expect, it } from 'vitest';
import { flattenKeys, LOCALES, messages } from './index';
import {
  ALLERGENS,
  GUEST_ACTIONS,
  ORDER_ITEM_STATUSES,
  ORDER_STATUSES,
  ROLES,
  TABLE_STATUSES,
  VEG_TYPES,
} from '@dinesense/shared';

describe('i18n catalogs', () => {
  const enKeys = flattenKeys(messages.en).sort();

  it.each(LOCALES)('%s has exactly the same keys as en', (locale) => {
    expect(flattenKeys(messages[locale]).sort()).toEqual(enKeys);
  });

  it('has a label for every table status and veg type', () => {
    for (const s of TABLE_STATUSES) expect(enKeys).toContain(`tableStatus.${s}`);
    for (const v of VEG_TYPES) expect(enKeys).toContain(`vegType.${v}`);
  });

  it('has a label for every allergen, role, order/item status and guest action', () => {
    for (const a of ALLERGENS) expect(enKeys).toContain(`guest.allergens.${a}`);
    for (const r of ROLES) expect(enKeys).toContain(`roles.${r}`);
    for (const s of ORDER_ITEM_STATUSES) expect(enKeys).toContain(`guest.itemStatus.${s}`);
    for (const s of ORDER_STATUSES) {
      expect(enKeys).toContain(`guest.orderStatus.${s}`);
      expect(enKeys).toContain(`orders.status.${s}`);
    }
    for (const a of GUEST_ACTIONS) {
      expect(enKeys).toContain(`guest.actions.${a}`);
      expect(enKeys).toContain(`guest.actionSent.${a}`);
    }
  });
});
