import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { ENV, type Env } from './config/env';

/** Shared by main.ts and the integration tests so both run the exact same HTTP pipeline. */
export function configureApp(app: INestApplication): INestApplication {
  const env = app.get<Env>(ENV);
  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  // Edge snapshots arrive as raw JPEG bytes (signed over the exact bytes).
  (app as NestExpressApplication).useBodyParser('raw', { type: 'image/jpeg', limit: '3mb' });
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
    'trust proxy',
    env.TRUST_PROXY,
  );
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.enableShutdownHooks();

  const doc = new DocumentBuilder().setTitle('DineSense API').setVersion('0.1.0').addBearerAuth().build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc));
  return app;
}
