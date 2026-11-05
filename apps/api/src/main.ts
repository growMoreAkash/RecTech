import 'reflect-metadata';
import { loadDotenv } from './config/load-dotenv';
loadDotenv();
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { ENV, type Env } from './config/env';

async function main(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule, { bufferLogs: true }));
  await app.listen(app.get<Env>(ENV).PORT);
}

void main();
