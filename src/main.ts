import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  app.enableShutdownHooks();
  logger.log('Asistia daemon iniciado');

  process.on('unhandledRejection', (reason) => {
    logger.error(`UnhandledRejection: ${(reason as Error)?.stack || reason}`);
  });
  process.on('uncaughtException', (err) => {
    logger.error(`UncaughtException: ${err.stack || err}`);
  });

  process.on('SIGINT', async () => {
    logger.log('SIGINT recibido, cerrando...');
    await app.close();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    logger.log('SIGTERM recibido, cerrando...');
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Error fatal arrancando el daemon:', err);
  process.exit(1);
});
