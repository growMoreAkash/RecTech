import { Global, Module } from '@nestjs/common';
import { RateLimitService } from '../common/rate-limit.service';
import { channelFactory, ConsoleChannel, WhatsAppChannel } from './channels';
import { MessageDispatchMonitor } from './message-dispatch.monitor';
import { WhatsAppWebhookController } from './messaging.controller';
import { MessagingService } from './messaging.service';

@Global()
@Module({
  controllers: [WhatsAppWebhookController],
  providers: [
    ConsoleChannel,
    WhatsAppChannel,
    channelFactory,
    MessagingService,
    MessageDispatchMonitor,
    RateLimitService,
  ],
  exports: [MessagingService],
})
export class MessagingModule {}
