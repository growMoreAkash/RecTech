import { Module } from '@nestjs/common';
import { TableStateModule } from '../table-state/table-state.module';
import { OrdersController } from './orders.controller';
import { OrderingService } from './ordering.service';

@Module({
  imports: [TableStateModule],
  controllers: [OrdersController],
  providers: [OrderingService],
  exports: [OrderingService],
})
export class OrderingModule {}
