import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { EdgeService } from './edge.service';

/** Periodically marks silent cameras / edge devices offline (alerts dedupe, so several replicas are harmless). */
@Injectable()
export class EdgeHealthMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EdgeHealthMonitor.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly edge: EdgeService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (!this.env.EDGE_HEALTH_SWEEP_SECONDS) return;
    this.timer = setInterval(() => {
      this.edge.sweep().catch((e: unknown) => this.logger.warn(`edge sweep failed: ${String(e)}`));
    }, this.env.EDGE_HEALTH_SWEEP_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
