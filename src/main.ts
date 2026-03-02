// =============================================================================
// src/main.ts — NestJS Bootstrap (API Center entry point)
// =============================================================================
// Bootstraps the NestJS application with all security middleware, connects
// to Kafka, and starts listening for HTTP requests.
//
// NESTJS vs EXPRESS:
//  NestJS wraps Express under the hood but adds:
//  - Dependency Injection (DI) — services are injected, not imported as singletons
//  - Decorators — @Controller, @Injectable, @Module, @Guard, @Interceptor, @Pipe
//  - Modular architecture — each domain is a self-contained module
//  - Built-in support for guards, interceptors, pipes, filters, middleware
//
// GRACEFUL SHUTDOWN:
//  NestJS has built-in shutdown hooks. When the process receives SIGTERM or
//  SIGINT, the framework calls onModuleDestroy() / onApplicationShutdown()
//  on every module that implements the lifecycle interface.
// =============================================================================

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { LoggerService } from './shared/logger.service';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { CorrelationIdInterceptor } from './shared/interceptors/correlation-id.interceptor';
import { AuditLogInterceptor } from './shared/interceptors/audit-log.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use our Winston-based logger for all NestJS internal logging
  const logger = app.get(LoggerService);
  app.useLogger(logger);

  // ---------------------------------------------------------------------------
  // Global Middleware
  // ---------------------------------------------------------------------------
  app.use(helmet());                         // Security HTTP headers
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : '*',
    credentials: true,
  });

  // ---------------------------------------------------------------------------
  // Global Pipes — validate & transform every incoming request body
  // ---------------------------------------------------------------------------
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // Strip unknown properties
      forbidNonWhitelisted: true, // Throw if unknown properties are sent
      transform: true,           // Auto-transform payloads to DTO instances
    }),
  );

  // ---------------------------------------------------------------------------
  // Global Interceptors — run on every request
  // ---------------------------------------------------------------------------
  const correlationInterceptor = app.get(CorrelationIdInterceptor);
  const auditInterceptor = app.get(AuditLogInterceptor);
  app.useGlobalInterceptors(correlationInterceptor, auditInterceptor);

  // ---------------------------------------------------------------------------
  // Global Exception Filter — catch all unhandled errors
  // ---------------------------------------------------------------------------
  app.useGlobalFilters(app.get(AllExceptionsFilter));

  // ---------------------------------------------------------------------------
  // API Versioning — all routes under /api/v1/
  // ---------------------------------------------------------------------------
  app.setGlobalPrefix('api/v1');

  // ---------------------------------------------------------------------------
  // Graceful Shutdown
  // ---------------------------------------------------------------------------
  app.enableShutdownHooks();

  // ---------------------------------------------------------------------------
  // Start the server
  // ---------------------------------------------------------------------------
  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`API Center running on port ${port}`, 'Bootstrap');
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`, 'Bootstrap');
  logger.log('Mode: dynamic-service-registry (NestJS)', 'Bootstrap');
}

bootstrap();
