import { Module } from '@nestjs/common';
import { NoopSlaScheduler, SLA_SCHEDULER } from './sla-scheduler';
import { TableStateController } from './table-state.controller';
import { TableStateService } from './table-state.service';
import { TableViews } from './table-views';

@Module({
  controllers: [TableStateController],
  providers: [TableStateService, TableViews, { provide: SLA_SCHEDULER, useClass: NoopSlaScheduler }],
  exports: [TableStateService, TableViews],
})
export class TableStateModule {}
