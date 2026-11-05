import { Injectable, Logger } from '@nestjs/common';

export const SLA_SCHEDULER = Symbol('SLA_SCHEDULER');

/**
 * Greet-SLA timers (docs/PLAN.md §5). TableStateService calls these after commit.
 * M2 ships a logging no-op; M5 provides the BullMQ implementation behind the same interface.
 */
export interface SlaScheduler {
  startGreetSla(input: {
    organizationId: string;
    outletId: string;
    seatingId: string;
    seatedAt: Date;
  }): Promise<void>;
  cancelGreetSla(input: { seatingId: string }): Promise<void>;
}

@Injectable()
export class NoopSlaScheduler implements SlaScheduler {
  private readonly logger = new Logger('SlaScheduler');

  startGreetSla(input: { seatingId: string }): Promise<void> {
    this.logger.debug(`greet SLA would start for seating ${input.seatingId}`);
    return Promise.resolve();
  }

  cancelGreetSla(input: { seatingId: string }): Promise<void> {
    this.logger.debug(`greet SLA would be cancelled for seating ${input.seatingId}`);
    return Promise.resolve();
  }
}
