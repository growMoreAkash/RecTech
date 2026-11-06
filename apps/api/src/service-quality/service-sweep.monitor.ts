import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { ServiceEngine } from './service-engine.service';

/** Runs the service-quality sweep (idle tables, held courses, dessert offers) every SERVICE_SWEEP_SECONDS. */
@Injectable()
export class ServiceSweepMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceSweepMonitor.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly engine: ServiceEngine,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (!this.env.SERVICE_SWEEP_SECONDS) return;
    this.timer = setInterval(() => {
      this.engine.sweep().catch((e: unknown) => this.logger.warn(`service sweep failed: ${String(e)}`));
    }, this.env.SERVICE_SWEEP_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
