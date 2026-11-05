import { Global, Module } from '@nestjs/common';
import { NotifierService } from './notifier.service';
import { PushController } from './push.controller';
import { PushService, pushSenderProvider } from './push.service';

@Global()
@Module({
  controllers: [PushController],
  providers: [PushService, NotifierService, pushSenderProvider],
  exports: [NotifierService, PushService],
})
export class NotificationsModule {}
