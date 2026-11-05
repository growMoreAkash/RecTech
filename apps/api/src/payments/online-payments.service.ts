import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { AuditActor } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { GuestClaims } from '../guest/guest-token';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider';

interface RazorpayWebhook {
  event?: string;
  payload?: {
    payment?: {
      entity?: { id?: string; order_id?: string; amount?: number; error_description?: string | null };
    };
    order?: { entity?: { id?: string } };
  };
}

/** Pay-at-table: the guest's phone starts a provider checkout for a bill or a split share. */
@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger(OnlinePaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async available(outletId: string): Promise<boolean> {
    if (!this.provider.enabled) return false;
    const s = await this.prisma.outletSettings.findUnique({ where: { outletId } });
    return !!s?.onlinePaymentsEnabled;
  }

  async bills(g: GuestClaims) {
    return { onlinePayments: await this.available(g.out), bills: await this.billing.guestBills(g) };
  }

  async start(g: GuestClaims, billId: string, shareKey?: string) {
    if (!(await this.available(g.out)))
      throw new AppError(
        'PAYMENTS_UNAVAILABLE',
        HttpStatus.CONFLICT,
        'Online payment is off for this outlet',
      );
    const audit: AuditActor = { organizationId: g.org, type: 'GUEST', id: g.sid };
    const { payment, bill, reused } = await this.billing.reserveOnline(
      g,
      billId,
      shareKey,
      this.provider.name,
      audit,
    );
    let orderId = payment.providerOrderId;
    if (!reused || !orderId) {
      try {
        ({ orderId } = await this.provider.createOrder({
          amountPaise: payment.amountPaise,
          receipt: payment.id,
          notes: { billId, invoice: bill.invoiceNumber ?? '', share: shareKey ?? '' },
        }));
      } catch (e) {
        await this.billing.failOnline({ paymentId: payment.id }, 'order creation failed');
        throw e;
      }
      await this.billing.attachProviderOrder(payment.id, orderId);
    }
    const outlet = await this.prisma.outlet.findUniqueOrThrow({
      where: { id: g.out },
      select: { name: true },
    });
    return {
      provider: this.provider.name,
      keyId: this.provider.publicKey,
      orderId,
      amountPaise: payment.amountPaise,
      currency: 'INR',
      name: outlet.name,
      description: bill.invoiceNumber ?? '',
    };
  }

  /** Browser callback after checkout. The webhook confirms the same payment independently. */
  async verify(g: GuestClaims, orderId: string, paymentId: string, signature: string) {
    const p = await this.prisma.payment.findUnique({ where: { providerOrderId: orderId } });
    if (!p || p.organizationId !== g.org || p.outletId !== g.out) throw AppError.notFound('Payment');
    if (!this.provider.verifyCheckout(orderId, paymentId, signature))
      throw new AppError('PAYMENT_VERIFICATION_FAILED', HttpStatus.BAD_REQUEST, 'Signature mismatch');
    await this.billing.captureOnline(orderId, paymentId);
    return this.bills(g);
  }

  async abandon(g: GuestClaims, orderId: string) {
    const p = await this.prisma.payment.findUnique({ where: { providerOrderId: orderId } });
    if (!p || p.organizationId !== g.org || p.outletId !== g.out) throw AppError.notFound('Payment');
    // Only a still-pending reservation; a capture arriving later is still recorded (captureOnline accepts it).
    await this.billing.failOnline({ paymentId: p.id }, 'checkout not opened');
  }

  async webhook(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody || !signature || !this.provider.verifyWebhook(rawBody, signature))
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Bad webhook signature');
    let event: RazorpayWebhook;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhook;
    } catch {
      throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Invalid JSON');
    }
    const pay = event.payload?.payment?.entity;
    const orderId = pay?.order_id ?? event.payload?.order?.entity?.id;
    if (!orderId) return { ok: true, ignored: true };
    switch (event.event) {
      case 'payment.captured':
      case 'order.paid':
        if (pay?.id) await this.billing.captureOnline(orderId, pay.id, pay.amount);
        break;
      case 'payment.failed':
        await this.billing.failOnline({ providerOrderId: orderId }, pay?.error_description ?? 'failed');
        break;
      default:
        this.logger.debug(`razorpay webhook ${event.event} ignored`);
        return { ok: true, ignored: true };
    }
    return { ok: true };
  }
}
