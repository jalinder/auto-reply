import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BrowserWorkerModule } from './browser-worker.module';
import { BrowserSessionManager } from './modules/browser/session-manager';
import { appLogger } from './common/json-logger';
import { serveMetrics } from './common/metrics';
import { config } from './common/config';

/**
 * Browser worker: hosts WhatsApp Web sessions (Puppeteer/Chromium). Deploy separately from the
 * API and send worker, in isolated containers with CPU/memory limits and no inbound ports.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(BrowserWorkerModule, { logger: appLogger('browser-worker') });
  serveMetrics(config.metricsPort);
  const manager = app.get(BrowserSessionManager);
  await manager.start();
  const shutdown = async () => {
    Logger.log('Stopping browser sessions…', 'BrowserWorker');
    await app.close(); // releases leases so other workers can restore sessions quickly
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
bootstrap();
