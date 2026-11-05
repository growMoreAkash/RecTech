import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AlertsModule } from './alerts/alerts.module';
import { AuditModule } from './audit/audit.module';
import { BillingModule } from './billing/billing.module';
import { AuthModule } from './auth/auth.module';
import { ErrorFilter } from './common/error.filter';
import { ConfigModule } from './config/config.module';
import { ENV, type Env } from './config/env';
import { DevicesModule } from './devices/devices.module';
import { FloorModule } from './floor/floor.module';
import { GuestModule } from './guest/guest.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { TasksModule } from './tasks/tasks.module';
import { MenuModule } from './menu/menu.module';
import { OrderingModule } from './ordering/ordering.module';
import { OutletsModule } from './outlets/outlets.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { StaffModule } from './staff/staff.module';
import { TableStateModule } from './table-state/table-state.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id =
              typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-device-token"]'],
          customProps: (req) => ({ userId: (req as { user?: { sub?: string } }).user?.sub }),
          ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    AuditModule,
    AuthModule,
    OutletsModule,
    DevicesModule,
    RealtimeModule,
    NotificationsModule,
    TasksModule,
    TableStateModule,
    FloorModule,
    StaffModule,
    AlertsModule,
    MenuModule,
    OrderingModule,
    GuestModule,
    BillingModule,
  ],
  controllers: [HealthController, MeController],
  providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
})
export class AppModule {}
