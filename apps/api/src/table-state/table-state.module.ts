import { Module } from '@nestjs/common';
import { AssignmentsController } from '../sla/assignments.controller';
import { AssignmentsService } from '../sla/assignments.service';
import { BullmqSlaScheduler } from '../sla/bullmq-sla-scheduler';
import { SlaEngine } from '../sla/sla-engine.service';
import { SeatingEvents } from './seating-events';
import { SLA_SCHEDULER } from './sla-scheduler';
import { TableStateController } from './table-state.controller';
import { TableStateService } from './table-state.service';
import { TableViews } from './table-views';

/** Table state + the greet-SLA engine (they share TableViews and must not import each other's modules). */
@Module({
  controllers: [TableStateController, AssignmentsController],
  providers: [
    TableStateService,
    TableViews,
    SeatingEvents,
    SlaEngine,
    AssignmentsService,
    BullmqSlaScheduler,
    { provide: SLA_SCHEDULER, useExisting: BullmqSlaScheduler },
  ],
  exports: [TableStateService, SeatingEvents, TableViews, SlaEngine, AssignmentsService, SLA_SCHEDULER],
})
export class TableStateModule {}
