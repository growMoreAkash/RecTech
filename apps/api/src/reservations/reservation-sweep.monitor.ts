import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { ReservationsService } from './reservations.service';

/** Holds tables before bookings and marks no-shows (idempotent; tests call sweep(now) directly). */
@Injectable()
export class ReservationSweepMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationSweepMonitor.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly reservations: ReservationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (!this.env.RESERVATION_SWEEP_SECONDS) return;
    this.timer = setInterval(() => {
      this.reservations
        .sweep()
        .catch((e: unknown) => this.logger.warn(`reservation sweep failed: ${String(e)}`));
    }, this.env.RESERVATION_SWEEP_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
