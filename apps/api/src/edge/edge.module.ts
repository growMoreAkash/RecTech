import { Module } from '@nestjs/common';
import { TableStateModule } from '../table-state/table-state.module';
import { CamerasController } from './cameras.controller';
import { EdgeCrypto } from './edge-crypto';
import { EdgeHealthMonitor } from './edge-health.monitor';
import { EdgeController } from './edge.controller';
import { EdgeGuard } from './edge.guard';
import { EdgeService } from './edge.service';

@Module({
  imports: [TableStateModule],
  controllers: [EdgeController, CamerasController],
  providers: [EdgeCrypto, EdgeGuard, EdgeService, EdgeHealthMonitor],
  exports: [EdgeService, EdgeCrypto],
})
export class EdgeModule {}
