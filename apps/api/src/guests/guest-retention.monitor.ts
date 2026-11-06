import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { GuestsService } from './guests.service';

/** Periodic DPDP retention sweep (idempotent; safe with several API replicas). */
@Injectable()
export class GuestRetentionMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GuestRetentionMonitor.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly guests: GuestsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (!this.env.GUEST_RETENTION_SWEEP_SECONDS) return;
    this.timer = setInterval(() => {
      this.guests
        .retentionSweep()
        .catch((e: unknown) => this.logger.warn(`retention sweep failed: ${String(e)}`));
    }, this.env.GUEST_RETENTION_SWEEP_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
