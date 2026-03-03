// =============================================================================
// src/config/config.service.ts — Centralized application configuration
// =============================================================================
// Loads environment variables from .env and provides a strongly-typed config
// throughout the app via NestJS dependency injection.
// No other module accesses process.env directly — this is the single source.
// =============================================================================

import { Injectable, OnModuleInit } from '@nestjs/common';
import dotenv from 'dotenv';

// Load .env file before reading any env vars
dotenv.config();

@Injectable()
export class ConfigService implements OnModuleInit {
  // ---- Server ----
  readonly port: number = parseInt(process.env.PORT || '3000', 10);
  readonly nodeEnv: string = process.env.NODE_ENV || 'development';

  // ---- CORS ----
  readonly cors = {
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ('*' as string | string[]),
    credentials: true,
  };

  // ---- Descope (Authentication & Authorization) ----
  readonly descope = {
    projectId: process.env.DESCOPE_PROJECT_ID || '',
    managementKey: process.env.DESCOPE_MANAGEMENT_KEY || '',
  };

  // ---- Kafka (Event Streaming) ----
  readonly kafka = {
    clientId: process.env.KAFKA_CLIENT_ID || 'api-center',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'api-center-group',
  };

  // ---- Platform Admin Secret ----
  readonly platformAdminSecret: string = process.env.PLATFORM_ADMIN_SECRET || '';

  // ---- Redis (split responsibilities) ----
  readonly redis = {
    /** Rate limiting + throttler (dedicated instance) */
    rateLimitUrl: process.env.REDIS_RATE_LIMIT_URL || 'redis://localhost:6380',
    /** Token cache + registry persistence (dedicated instance) */
    cacheUrl: process.env.REDIS_CACHE_URL || 'redis://localhost:6381',
  };

  // ---- Supabase (optional — persistent registry storage) ----
  readonly supabase = {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };

  // ---- Rate Limiting ----
  readonly rateLimit = {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  };

  // ---- External APIs (third-party only: geo) ----
  readonly external = {
    timeout: 10000, // 10 seconds default timeout
    geolocation: {
      url: process.env.GEOLOCATION_API_URL || 'https://api.ipgeolocation.io',
      key: process.env.GEOLOCATION_API_KEY || '',
    },
    geofencing: {
      url: process.env.GEOFENCING_API_URL || 'https://api.geofencing.example.com',
      key: process.env.GEOFENCING_API_KEY || '',
    },
  };

  // ---- Tracing ----
  readonly tracing = {
    jaegerEndpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
    serviceName: process.env.OTEL_SERVICE_NAME || 'api-center',
  };

  // ---- CORS (parsed) ----
  readonly allowedOrigins: string | string[] = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : '*';

  /** Check if running in production */
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  // ── Startup validation ───────────────────────────────────────────────────
  onModuleInit() {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Platform admin secret is required in production
    if (!this.platformAdminSecret && this.isProduction) {
      errors.push('PLATFORM_ADMIN_SECRET must be set in production');
    }

    // Descope credentials
    if (!this.descope.projectId) {
      warnings.push('DESCOPE_PROJECT_ID is not set — auth endpoints will fail');
    }

    // Kafka brokers should not be defaults in production
    if (this.isProduction && this.kafka.brokers.includes('localhost:9092')) {
      warnings.push('KAFKA_BROKERS still points to localhost in production');
    }

    // Redis URLs should not be defaults in production
    if (this.isProduction) {
      if (this.redis.rateLimitUrl.includes('localhost')) {
        warnings.push('REDIS_RATE_LIMIT_URL still points to localhost in production');
      }
      if (this.redis.cacheUrl.includes('localhost')) {
        warnings.push('REDIS_CACHE_URL still points to localhost in production');
      }
    }

    // Log warnings
    for (const w of warnings) {
      console.warn(`[ConfigService] WARNING: ${w}`);
    }

    // Fail hard on errors
    if (errors.length > 0) {
      const msg = `[ConfigService] Fatal configuration errors:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
      console.error(msg);
      throw new Error(msg);
    }
  }
}
