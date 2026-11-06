import { Module } from '@nestjs/common';
import { TableStateModule } from '../table-state/table-state.module';
import { TasksController } from './tasks.controller';

@Module({ imports: [TableStateModule], controllers: [TasksController] })
export class TasksModule {}
