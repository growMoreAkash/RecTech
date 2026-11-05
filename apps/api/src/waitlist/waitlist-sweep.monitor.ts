import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { WaitlistService } from './waitlist.service';

/** Releases table holds of notified parties who didn't come in time (same cadence as booking holds). */
@Injectable()
export class WaitlistSweepMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaitlistSweepMonitor.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly waitlist: WaitlistService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (!this.env.RESERVATION_SWEEP_SECONDS) return;
    this.timer = setInterval(() => {
      this.waitlist.sweep().catch((e: unknown) => this.logger.warn(`waitlist sweep failed: ${String(e)}`));
    }, this.env.RESERVATION_SWEEP_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
