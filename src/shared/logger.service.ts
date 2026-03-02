// =============================================================================
// src/shared/logger.service.ts — Structured logging with Winston (NestJS)
// =============================================================================
// NestJS LoggerService implementation backed by Winston.
// Replaces console.log with machine-readable structured logs.
//
// WHY: In production, plain console.log is useless. You need:
//  - JSON format so log aggregators (ELK, Datadog, CloudWatch) can parse them
//  - Log levels (error > warn > info > debug) to filter noise
//  - Timestamps, correlation IDs, and service names on every log line
// =============================================================================

import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import winston from 'winston';

// ---------------------------------------------------------------------------
// Custom format: adds service name and environment to every log entry
// ---------------------------------------------------------------------------
const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format((info) => {
    info.service = 'api-center';
    info.environment = process.env.NODE_ENV || 'development';
    return info;
  })(),
);

const devFormat = winston.format.combine(
  baseFormat,
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const metaStr = Object.keys(meta).length > 1 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${service}] ${level}: ${message}${metaStr}`;
  }),
);

const prodFormat = winston.format.combine(baseFormat, winston.format.json());

const isProduction = process.env.NODE_ENV === 'production';

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly winstonLogger: winston.Logger;

  constructor() {
    this.winstonLogger = winston.createLogger({
      level: isProduction ? 'info' : 'debug',
      format: isProduction ? prodFormat : devFormat,
      defaultMeta: { service: 'api-center' },
      transports: [
        new winston.transports.Console(),
        ...(isProduction
          ? [
              new winston.transports.File({
                filename: 'logs/combined.log',
                maxsize: 10 * 1024 * 1024,
                maxFiles: 5,
              }),
              new winston.transports.File({
                filename: 'logs/error.log',
                level: 'error',
                maxsize: 10 * 1024 * 1024,
                maxFiles: 5,
              }),
            ]
          : []),
      ],
      exitOnError: false,
    });
  }

  /** Standard NestJS log (info level) */
  log(message: string, context?: string) {
    this.winstonLogger.info(message, { context });
  }

  /** Error level */
  error(message: string, trace?: string, context?: string) {
    this.winstonLogger.error(message, { trace, context });
  }

  /** Warn level */
  warn(message: string, context?: string) {
    this.winstonLogger.warn(message, { context });
  }

  /** Debug level */
  debug(message: string, context?: string) {
    this.winstonLogger.debug(message, { context });
  }

  /** Verbose level */
  verbose(message: string, context?: string) {
    this.winstonLogger.verbose(message, { context });
  }

  /** Direct access to Winston for structured metadata logging */
  info(message: string, meta?: Record<string, unknown>) {
    this.winstonLogger.info(message, meta);
  }

  /** Stream for Morgan HTTP request logging integration */
  get morganStream() {
    return {
      write: (msg: string) => {
        this.winstonLogger.info(msg.trim(), { component: 'http' });
      },
    };
  }
}
