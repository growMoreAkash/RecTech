/**
 * Online payment provider (PLAN §11 extension point: `razorpay` now; Cashfree / POS sync later).
 * Amounts are paise. Implementations never decide what a bill owes — BillingService does.
 */
export interface CheckoutOrder {
  orderId: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** False when credentials are missing: guests are told to pay at the counter. */
  readonly enabled: boolean;
  /** Public key the browser checkout needs (never the secret). */
  readonly publicKey: string | null;
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<CheckoutOrder>;
  /** Signature returned to the browser after a successful checkout. */
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean;
  /** Signature header of a server-to-server webhook over the exact raw body. */
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
