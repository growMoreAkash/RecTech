import { Module } from '@nestjs/common';
import { TableStateModule } from '../table-state/table-state.module';
import { OrdersController } from './orders.controller';
import { OrderingService } from './ordering.service';
import { PrepTimeService } from './prep-time.service';

@Module({
  imports: [TableStateModule],
  controllers: [OrdersController],
  providers: [OrderingService, PrepTimeService],
  exports: [OrderingService, PrepTimeService],
})
export class OrderingModule {}
