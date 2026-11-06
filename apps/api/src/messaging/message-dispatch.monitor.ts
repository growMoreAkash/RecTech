import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { MessagingService } from './messaging.service';

/** Sends queued guest messages every few seconds (leases rows, safe with several replicas). */
@Injectable()
export class MessageDispatchMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageDispatchMonitor.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly messaging: MessagingService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (!this.env.MESSAGE_DISPATCH_SECONDS) return;
    this.logger.log(`guest messages via ${this.messaging.channelName}`);
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.messaging
        .dispatch()
        .catch((e: unknown) => this.logger.warn(`dispatch failed: ${String(e)}`))
        .finally(() => (this.running = false));
    }, this.env.MESSAGE_DISPATCH_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
