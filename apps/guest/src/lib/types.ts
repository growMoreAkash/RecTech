import type { CartLineView } from '@dinesense/shared';

export interface ModifierGroup {
  id: string;
  name: unknown;
  minSelect: number;
  maxSelect: number;
  modifiers: { id: string; name: unknown; priceDeltaPaise: number; isAvailable: boolean }[];
}

export interface MenuItem {
  id: string;
  name: unknown;
  description: unknown;
  vegType: string;
  allergens: string[];
  spiceLevel: number;
  pricePaise: number;
  taxRateBps: number;
  imageUrl: string | null;
  isAvailable: boolean;
  modifierGroups: ModifierGroup[];
}

export interface Landing {
  outlet: { name: string };
  table: { label: string };
  open: boolean;
  menu: { categories: { id: string; name: unknown; items: MenuItem[] }[] };
}

export interface Totals {
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalPaise: number;
}

export interface Cart {
  lines: (CartLineView & { available: boolean })[];
  totals: Totals;
  canOrder: boolean;
}

export interface GuestOrder {
  id: string;
  number: number;
  status: 'PENDING_APPROVAL' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  rejectedReason: string | null;
  createdAt: string;
  items: {
    id: string;
    name: unknown;
    quantity: number;
    modifiers: { name: unknown }[];
    status: string;
    unitPricePaise: number;
  }[];
}

export interface Orders {
  orders: GuestOrder[];
  bill: Totals;
}
