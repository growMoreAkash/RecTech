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

export interface GuestShare {
  key: string;
  label: string | null;
  amountPaise: number;
  paidPaise: number;
  duePaise: number;
}

export interface GuestBill {
  id: string;
  status: 'OPEN' | 'FINALIZED' | 'PAID';
  invoiceNumber: string | null;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  invoiceUrl: string | null;
  split: { mode: string; shares: GuestShare[] } | null;
  lines: { id: string; description: string; quantity: number }[];
  checkoutInProgress: boolean;
}

export interface GuestBills {
  onlinePayments: boolean;
  bills: GuestBill[];
}

export interface CheckoutStart {
  provider: string;
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  name: string;
  description: string;
}

export interface BookingPage {
  name: string;
  address: string | null;
  slug: string;
  timezone: string;
  today: string;
  booking: { enabled: boolean; maxPartySize: number; horizonDays: number; slotMinutes: number };
  sections: { id: string; name: string }[];
}

export interface BookingSlot {
  time: string;
  startsAt: string;
  available: boolean;
}

export type Consents = Partial<Record<'WHATSAPP' | 'FEEDBACK' | 'MARKETING', boolean>>;

export interface GuestBooking {
  status: 'CONFIRMED' | 'SEATED' | 'CANCELLED' | 'NO_SHOW';
  startsAt: string;
  date: string;
  time: string;
  partySize: number;
  name: string | null;
  notes: string | null;
  consents: Consents;
  outlet: { name: string; address: string | null; slug: string; timezone: string };
  canChange: boolean;
  maxPartySize: number;
}

export interface QueuePage {
  name: string;
  address: string | null;
  slug: string;
  waitlist: { enabled: boolean; maxPartySize: number };
  waiting: number;
  waitForTwo: { low: number; high: number } | null;
}

export interface QueueStatus {
  status: 'WAITING' | 'NOTIFIED' | 'SEATED' | 'LEFT' | 'REMOVED';
  name: string | null;
  partySize: number;
  position: number | null;
  wait: { low: number; high: number } | null;
  notifiedAt: string | null;
  holdUntil: string | null;
  tables: string[];
  outlet: { name: string; slug: string };
  joinedAt: string;
}
