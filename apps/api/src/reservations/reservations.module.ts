import { Module } from '@nestjs/common';
import { RateLimitService } from '../common/rate-limit.service';
import { GuestsModule } from '../guests/guests.module';
import { TableStateModule } from '../table-state/table-state.module';
import { ReservationSweepMonitor } from './reservation-sweep.monitor';
import { BookingController, ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [TableStateModule, GuestsModule],
  controllers: [ReservationsController, BookingController],
  providers: [ReservationsService, ReservationSweepMonitor, RateLimitService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
