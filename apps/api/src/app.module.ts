import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ErrorFilter } from './common/error.filter';
import { ConfigModule } from './config/config.module';
import { ENV, type Env } from './config/env';
import { DevicesModule } from './devices/devices.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { OutletsModule } from './outlets/outlets.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

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
  ],
  controllers: [HealthController, MeController],
  providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
})
export class AppModule {}
