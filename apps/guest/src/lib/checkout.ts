import type { CheckoutStart } from './types';

/** Razorpay Checkout (UPI intent, cards, netbanking): loaded only when a guest taps Pay. */
export const RAZORPAY_CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export interface CheckoutSuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (r: { error?: { description?: string } }) => void): void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

/** The provider's checkout script could not be loaded (offline, blocked) — nothing was attempted. */
export class CheckoutUnavailable extends Error {
  constructor() {
    super('checkout unavailable');
  }
}

let loading: Promise<RazorpayCtor> | null = null;

function loadScript(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = RAZORPAY_CHECKOUT_SRC;
    el.async = true;
    el.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new CheckoutUnavailable()));
    el.onerror = () => {
      loading = null;
      reject(new CheckoutUnavailable());
    };
    document.head.appendChild(el);
  });
  return loading;
}

/** Options for the provider's checkout. No guest personal data is pre-filled. */
export function checkoutOptions(start: CheckoutStart, locale: string) {
  return {
    key: start.keyId,
    order_id: start.orderId,
    amount: start.amountPaise,
    currency: start.currency,
    name: start.name,
    description: start.description,
    theme: { color: '#c2410c' },
    notes: { locale },
  };
}

/**
 * Opens checkout; resolves with the signed result on success, `null` if the guest closes it,
 * rejects with the provider's message on a failed attempt.
 */
export async function openCheckout(start: CheckoutStart, locale: string): Promise<CheckoutSuccess | null> {
  const Razorpay = await loadScript();
  return new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      ...checkoutOptions(start, locale),
      handler: (r: CheckoutSuccess) => resolve(r),
      modal: { ondismiss: () => resolve(null) },
    });
    rzp.on('payment.failed', (r) => reject(new Error(r.error?.description ?? 'Payment failed')));
    rzp.open();
  });
}
