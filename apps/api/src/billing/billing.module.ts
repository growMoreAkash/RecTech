import { Module } from '@nestjs/common';
import { RateLimitService } from '../common/rate-limit.service';
import { GuestModule } from '../guest/guest.module';
import { OnlinePaymentsService } from '../payments/online-payments.service';
import { PAYMENT_PROVIDER } from '../payments/payment-provider';
import { GuestPaymentsController, PaymentWebhookController } from '../payments/payments.controller';
import { RazorpayProvider } from '../payments/razorpay.provider';
import { TableStateModule } from '../table-state/table-state.module';
import { BillingController, InvoiceController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [TableStateModule, GuestModule],
  controllers: [BillingController, InvoiceController, GuestPaymentsController, PaymentWebhookController],
  providers: [
    BillingService,
    OnlinePaymentsService,
    RateLimitService,
    { provide: PAYMENT_PROVIDER, useClass: RazorpayProvider },
  ],
  exports: [BillingService],
})
export class BillingModule {}
