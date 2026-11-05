import { Module } from '@nestjs/common';
import { TableStateModule } from '../table-state/table-state.module';
import { GuestRetentionMonitor } from './guest-retention.monitor';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';

@Module({
  imports: [TableStateModule],
  controllers: [GuestsController],
  providers: [GuestsService, GuestRetentionMonitor],
  exports: [GuestsService],
})
export class GuestsModule {}
