import { Module } from '@nestjs/common';
import { TableStateModule } from '../table-state/table-state.module';
import { BillingController, InvoiceController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [TableStateModule],
  controllers: [BillingController, InvoiceController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
