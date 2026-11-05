import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/app-error';
import { ENV, type Env } from '../config/env';
import type { CheckoutOrder, PaymentProvider } from './payment-provider';

export function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqualHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Razorpay Orders API + Checkout. Docs: an order fixes the amount server-side; the browser checkout returns
 * razorpay_signature = HMAC_SHA256(key_secret, `${order_id}|${payment_id}`); webhooks carry
 * X-Razorpay-Signature = HMAC_SHA256(webhook_secret, raw body).
 */
@Injectable()
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';
  private readonly logger = new Logger(RazorpayProvider.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return !!(this.env.RAZORPAY_KEY_ID && this.env.RAZORPAY_KEY_SECRET && this.env.RAZORPAY_WEBHOOK_SECRET);
  }

  get publicKey(): string | null {
    return this.env.RAZORPAY_KEY_ID ?? null;
  }

  async createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<CheckoutOrder> {
    if (!this.enabled)
      throw new AppError('PAYMENTS_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE, 'Not configured');
    const auth = Buffer.from(`${this.env.RAZORPAY_KEY_ID}:${this.env.RAZORPAY_KEY_SECRET}`).toString(
      'base64',
    );
    let res: Response;
    try {
      res = await fetch(`${this.env.RAZORPAY_API_URL}/orders`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: 'INR',
          receipt: input.receipt.slice(0, 40),
          notes: input.notes,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      this.logger.warn(`razorpay order failed: ${String(e)}`);
      throw new AppError('PAYMENTS_UNAVAILABLE', HttpStatus.BAD_GATEWAY, 'Payment provider unreachable');
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
    if (!res.ok || !body.id) {
      this.logger.warn(`razorpay order rejected (${res.status}): ${body.error?.description ?? 'no id'}`);
      throw new AppError(
        'PAYMENTS_UNAVAILABLE',
        HttpStatus.BAD_GATEWAY,
        'Payment provider rejected the order',
      );
    }
    return { orderId: body.id };
  }

  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean {
    if (!this.env.RAZORPAY_KEY_SECRET) return false;
    return safeEqualHex(hmacHex(this.env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`), signature);
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    if (!this.env.RAZORPAY_WEBHOOK_SECRET) return false;
    return safeEqualHex(hmacHex(this.env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);
  }
}
