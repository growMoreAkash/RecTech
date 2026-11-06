import { Module } from '@nestjs/common';
import { RateLimitService } from '../common/rate-limit.service';
import { ReservationsModule } from '../reservations/reservations.module';
import { TableStateModule } from '../table-state/table-state.module';
import { PublicWaitlistController, WaitlistController } from './waitlist.controller';
import { WaitlistSweepMonitor } from './waitlist-sweep.monitor';
import { WaitlistService } from './waitlist.service';

@Module({
  imports: [TableStateModule, ReservationsModule],
  controllers: [WaitlistController, PublicWaitlistController],
  providers: [WaitlistService, WaitlistSweepMonitor, RateLimitService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
