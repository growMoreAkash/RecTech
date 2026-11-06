import { Module } from '@nestjs/common';
import { OrderingModule } from '../ordering/ordering.module';
import { ServiceEngine } from './service-engine.service';
import { ServiceSweepMonitor } from './service-sweep.monitor';

@Module({
  imports: [OrderingModule],
  providers: [ServiceEngine, ServiceSweepMonitor],
  exports: [ServiceEngine],
})
export class ServiceQualityModule {}
