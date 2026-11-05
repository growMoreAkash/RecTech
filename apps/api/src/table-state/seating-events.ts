import { Injectable, Logger } from '@nestjs/common';

export interface SeatingClosed {
  organizationId: string;
  outletId: string;
  seatingId: string;
}

/**
 * In-process hook for modules that react to seatings (guest visit stats now; the domain-event outbox replaces it
 * when cross-process consumers arrive, PLAN-P3 §5). Handlers run after commit and never fail the caller.
 */
@Injectable()
export class SeatingEvents {
  private readonly logger = new Logger(SeatingEvents.name);
  private readonly closed: ((e: SeatingClosed) => Promise<void>)[] = [];

  onClosed(handler: (e: SeatingClosed) => Promise<void>) {
    this.closed.push(handler);
  }

  async emitClosed(e: SeatingClosed) {
    const results = await Promise.allSettled(this.closed.map((h) => h(e)));
    for (const r of results)
      if (r.status === 'rejected') this.logger.warn(`seating.closed handler: ${String(r.reason)}`);
  }
}
