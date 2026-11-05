import { Module } from '@nestjs/common';
import { TableStateModule } from '../table-state/table-state.module';
import { FloorController } from './floor.controller';
import { FloorService } from './floor.service';

@Module({ imports: [TableStateModule], controllers: [FloorController], providers: [FloorService] })
export class FloorModule {}
