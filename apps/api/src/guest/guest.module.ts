import { Module } from '@nestjs/common';
import { RateLimitService } from '../common/rate-limit.service';
import { MenuModule } from '../menu/menu.module';
import { OrderingModule } from '../ordering/ordering.module';
import { TableStateModule } from '../table-state/table-state.module';
import { GuestController } from './guest.controller';
import { GuestGuard } from './guest.guard';
import { GuestService } from './guest.service';
import { GuestTokens } from './guest-token';

@Module({
  imports: [MenuModule, OrderingModule, TableStateModule],
  controllers: [GuestController],
  providers: [GuestService, GuestGuard, GuestTokens, RateLimitService],
  exports: [GuestTokens],
})
export class GuestModule {}
