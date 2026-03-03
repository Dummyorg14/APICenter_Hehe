// =============================================================================
// src/registry/registry.service.ts — Dynamic Service Registry (NestJS)
// =============================================================================
// The heart of the "Dynamic Service Registry" platform. Services register
// themselves at runtime by POSTing a ServiceManifest.
//
// STORAGE STRATEGY (layered):
//  1. In-memory Map  — hot cache for zero-latency lookups (primary)
//  2. Redis          — source of truth, shared across instances (persistent)
//
// On startup (OnModuleInit), all entries are loaded from Redis into memory.
// On registration/deregistration, both memory and Redis are updated.
// =============================================================================

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import crypto from 'node:crypto';
import Redis from 'ioredis';
import {
  ServiceManifest,
  ServiceRegistryEntry,
  ServiceRegistryMap,
  ServiceType,
} from '../types';
import { LoggerService } from '../shared/logger.service';
import { ConfigService } from '../config/config.service';
import { KafkaService } from '../kafka/kafka.service';
import { MetricsService } from '../metrics/metrics.service';
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors';
import { TOPICS } from '../kafka/topics';

const REDIS_REGISTRY_KEY = 'api-center:registry:services';

@Injectable()
export class RegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly services: ServiceRegistryMap = {};
  private redis: Redis | null = null;

  constructor(
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
    private readonly kafka: KafkaService,
    private readonly metrics: MetricsService,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async onModuleInit() {
    try {
      this.redis = new Redis(this.config.redis.cacheUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 3000),
      });

      await this.redis.connect();
      this.logger.info('Registry connected to Redis (cache)', {});

      // Hydrate in-memory map from Redis on boot
      await this.loadFromRedis();
    } catch (err) {
      this.logger.warn(
        `Registry Redis unavailable — running in memory-only mode: ${(err as Error).message}`,
        'RegistryService',
      );
      this.redis = null;
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
      this.logger.info('Registry Redis connection closed', {});
    }
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a new service or update an existing one.
   * Writes to both in-memory Map and Redis.
   * Validates semver on updates and tracks version changes.
   */
  register(manifest: ServiceManifest): ServiceRegistryEntry {
    const now = new Date().toISOString();
    const existing = this.services[manifest.serviceId];

    // ── Version governance ─────────────────────────────────────────────────
    let previousVersion: string | undefined;
    if (existing && manifest.version && existing.version) {
      previousVersion = existing.version;
      this.validateVersionUpgrade(existing.version, manifest.version);
    }

    // ── Block registration if service is retired ───────────────────────────
    if (existing?.status === 'retired') {
      throw new ConflictError(
        `Service '${manifest.serviceId}' is retired and cannot be re-registered`,
      );
    }

    const entry: ServiceRegistryEntry = {
      ...manifest,
      serviceType: manifest.serviceType || 'tribe',
      registeredAt: existing?.registeredAt || now,
      updatedAt: now,
      status: existing?.status === 'deprecated' ? 'deprecated' : 'active',
      ...(previousVersion && { previousVersion }),
    };

    this.services[manifest.serviceId] = entry;
    this.syncMetricsGauge();

    // Persist to Redis (fire-and-forget, non-blocking)
    this.persistToRedis(manifest.serviceId, entry).catch((err) => {
      this.logger.error(
        `Failed to persist service to Redis: ${(err as Error).message}`,
        (err as Error).stack,
        'RegistryService',
      );
    });

    // ── Kafka events ──────────────────────────────────────────────────────
    this.kafka
      .publish(TOPICS.SERVICE_REGISTERED, {
        serviceId: manifest.serviceId,
        name: manifest.name,
        baseUrl: manifest.baseUrl,
        exposes: manifest.exposes,
        serviceType: entry.serviceType,
        isUpdate: !!existing,
        timestamp: now,
      })
      .catch((err) => {
        this.logger.warn(
          `Kafka publish failed for ${TOPICS.SERVICE_REGISTERED}: ${(err as Error).message}`,
          'RegistryService',
        );
      });

    if (previousVersion && previousVersion !== manifest.version) {
      this.kafka
        .publish(TOPICS.SERVICE_VERSION_CHANGED, {
          serviceId: manifest.serviceId,
          previousVersion,
          newVersion: manifest.version,
          timestamp: now,
        })
        .catch((err) => {
          this.logger.warn(
            `Kafka publish failed for ${TOPICS.SERVICE_VERSION_CHANGED}: ${(err as Error).message}`,
            'RegistryService',
          );
        });
    }

    this.logger.info('Service registered', {
      serviceId: manifest.serviceId,
      name: manifest.name,
      baseUrl: manifest.baseUrl,
      exposes: manifest.exposes,
      isUpdate: !!existing,
      version: manifest.version,
    });

    return entry;
  }

  /**
   * Remove a service from the registry.
   * Removes from both in-memory Map and Redis.
   */
  deregister(serviceId: string): void {
    const existing = this.services[serviceId];
    if (!existing) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }

    delete this.services[serviceId];
    this.syncMetricsGauge();

    // Remove from Redis (fire-and-forget)
    this.removeFromRedis(serviceId).catch((err) => {
      this.logger.error(
        `Failed to remove service from Redis: ${(err as Error).message}`,
        (err as Error).stack,
        'RegistryService',
      );
    });

    this.kafka
      .publish(TOPICS.SERVICE_DEREGISTERED, {
        serviceId,
        timestamp: new Date().toISOString(),
      })
      .catch((err) => {
        this.logger.warn(
          `Kafka publish failed for ${TOPICS.SERVICE_DEREGISTERED}: ${(err as Error).message}`,
          'RegistryService',
        );
      });

    this.logger.info('Service deregistered', { serviceId });
  }

  // -------------------------------------------------------------------------
  // Lifecycle management
  // -------------------------------------------------------------------------

  /**
   * Mark a service as deprecated. It remains routable but consumers receive
   * sunset warnings in proxy response headers.
   */
  deprecate(serviceId: string, sunsetDate?: string, replacementService?: string): ServiceRegistryEntry {
    const entry = this.services[serviceId];
    if (!entry) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }
    if (entry.status === 'retired') {
      throw new ConflictError(`Service '${serviceId}' is already retired`);
    }

    entry.status = 'deprecated';
    entry.updatedAt = new Date().toISOString();
    if (sunsetDate) entry.sunsetDate = sunsetDate;
    if (replacementService) entry.replacementService = replacementService;

    this.persistToRedis(serviceId, entry).catch((err) => {
      this.logger.warn(
        `Redis persist failed for deprecated service '${serviceId}': ${(err as Error).message}`,
        'RegistryService',
      );
    });

    this.kafka
      .publish(TOPICS.SERVICE_DEPRECATED, {
        serviceId,
        sunsetDate: entry.sunsetDate,
        replacementService: entry.replacementService,
        timestamp: entry.updatedAt,
      })
      .catch((err) => {
        this.logger.warn(
          `Kafka publish failed for ${TOPICS.SERVICE_DEPRECATED}: ${(err as Error).message}`,
          'RegistryService',
        );
      });

    this.logger.warn(
      `Service '${serviceId}' deprecated (sunset: ${sunsetDate || 'unset'}, replacement: ${replacementService || 'none'})`,
      'RegistryService',
    );

    return entry;
  }

  /**
   * Retire a service — it will no longer be routable.
   * Consumers calling this service will receive 410 Gone.
   */
  retire(serviceId: string): ServiceRegistryEntry {
    const entry = this.services[serviceId];
    if (!entry) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }

    entry.status = 'retired';
    entry.updatedAt = new Date().toISOString();

    this.persistToRedis(serviceId, entry).catch((err) => {
      this.logger.warn(
        `Redis persist failed for retired service '${serviceId}': ${(err as Error).message}`,
        'RegistryService',
      );
    });
    this.syncMetricsGauge();

    this.kafka
      .publish(TOPICS.SERVICE_RETIRED, {
        serviceId,
        timestamp: entry.updatedAt,
      })
      .catch((err) => {
        this.logger.warn(
          `Kafka publish failed for ${TOPICS.SERVICE_RETIRED}: ${(err as Error).message}`,
          'RegistryService',
        );
      });

    this.logger.warn(`Service '${serviceId}' retired — no longer routable`, 'RegistryService');

    return entry;
  }

  /**
   * Transition a proposed service to active.
   */
  activate(serviceId: string): ServiceRegistryEntry {
    const entry = this.services[serviceId];
    if (!entry) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }
    if (entry.status !== 'proposed' && entry.status !== 'deprecated') {
      throw new ConflictError(
        `Service '${serviceId}' is '${entry.status}' and cannot be activated`,
      );
    }

    entry.status = 'active';
    entry.updatedAt = new Date().toISOString();
    entry.sunsetDate = undefined;
    entry.replacementService = undefined;

    this.persistToRedis(serviceId, entry).catch((err) => {
      this.logger.warn(
        `Redis persist failed for activated service '${serviceId}': ${(err as Error).message}`,
        'RegistryService',
      );
    });
    this.syncMetricsGauge();

    this.logger.info(`Service '${serviceId}' activated`, {});
    return entry;
  }

  /**
   * Check whether a service is currently routable.
   */
  isRoutable(serviceId: string): boolean {
    const entry = this.services[serviceId];
    if (!entry) return false;
    return entry.status === 'active' || entry.status === 'deprecated';
  }

  /**
   * Get consumers — services that list the given serviceId in their consumes array.
   */
  getConsumers(serviceId: string): string[] {
    return Object.values(this.services)
      .filter((svc) => svc.consumes.includes(serviceId))
      .map((svc) => svc.serviceId);
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  get(serviceId: string): ServiceRegistryEntry | null {
    return this.services[serviceId] || null;
  }

  getAll(): ServiceRegistryMap {
    return { ...this.services };
  }

  /**
   * Return all entries filtered by serviceType ('shared' or 'tribe').
   * Services without an explicit serviceType default to 'tribe'.
   */
  getByType(type: ServiceType): ServiceRegistryEntry[] {
    return Object.values(this.services).filter(
      (svc) => (svc.serviceType ?? 'tribe') === type,
    );
  }

  count(): number {
    return Object.keys(this.services).length;
  }

  // -------------------------------------------------------------------------
  // Access Control
  // -------------------------------------------------------------------------

  canConsume(sourceServiceId: string, targetServiceId: string): boolean {
    const source = this.services[sourceServiceId];
    if (!source) return false;
    return source.consumes.includes(targetServiceId);
  }

  getRequiredScopes(targetServiceId: string): string[] {
    const target = this.services[targetServiceId];
    if (!target) return [];
    return target.requiredScopes;
  }

  // -------------------------------------------------------------------------
  // Proxy resolution
  // -------------------------------------------------------------------------

  resolveUpstream(serviceId: string, path: string): string | null {
    const service = this.services[serviceId];
    if (!service) return null;
    return `${service.baseUrl}${path}`;
  }

  // -------------------------------------------------------------------------
  // Secret validation
  // -------------------------------------------------------------------------

  async validateSecret(serviceId: string, secret: string): Promise<boolean> {
    const envKey = `TRIBE_SECRET_${serviceId.toUpperCase().replaceAll('-', '_')}`;
    const expected = process.env[envKey];
    if (!expected) return false;

    const hash = crypto.createHash('sha256').update(secret).digest('hex');
    if (hash.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
  }

  // -------------------------------------------------------------------------
  // Bulk seeding
  // -------------------------------------------------------------------------

  seed(manifests: ServiceManifest[]): void {
    for (const manifest of manifests) {
      this.register(manifest);
    }
    this.logger.info(`Registry seeded with ${manifests.length} service(s)`, {});
  }

  // -------------------------------------------------------------------------
  // Version governance (private)
  // -------------------------------------------------------------------------

  /**
   * Validate that a version upgrade follows semver rules.
   * Prevents major-version downgrades without explicit re-registration.
   */
  private validateVersionUpgrade(currentVersion: string, newVersion: string): void {
    const parseSemver = (v: string) => {
      const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
      if (!match) return null;
      return { major: Number.parseInt(match[1]), minor: Number.parseInt(match[2]), patch: Number.parseInt(match[3]) };
    };

    const current = parseSemver(currentVersion);
    const next = parseSemver(newVersion);

    if (!current || !next) return; // Skip validation if versions aren't semver

    if (next.major < current.major) {
      throw new ValidationError(
        `Version downgrade from ${currentVersion} to ${newVersion} is not allowed. ` +
        `Deregister the service first if you need to roll back a major version.`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Metrics sync (private)
  // -------------------------------------------------------------------------

  private syncMetricsGauge(): void {
    const activeCount = Object.values(this.services).filter(
      (s) => s.status === 'active' || s.status === 'deprecated',
    ).length;
    this.metrics.setRegistryServicesCount(activeCount);
  }

  // -------------------------------------------------------------------------
  // Redis persistence (private)
  // -------------------------------------------------------------------------

  /**
   * Load all service entries from Redis into the in-memory Map.
   * Called once during onModuleInit to survive gateway restarts.
   */
  private async loadFromRedis(): Promise<void> {
    if (!this.redis) return;

    const entries = await this.redis.hgetall(REDIS_REGISTRY_KEY);
    let count = 0;

    for (const [serviceId, json] of Object.entries(entries)) {
      try {
        const entry: ServiceRegistryEntry = JSON.parse(json);
        this.services[serviceId] = entry;
        count++;
      } catch (err) {
        this.logger.warn(
          `Failed to parse Redis registry entry for '${serviceId}': ${(err as Error).message}`,
          'RegistryService',
        );
      }
    }

    if (count > 0) {
      this.logger.info(`Registry hydrated ${count} service(s) from Redis`, {});
    }
  }

  /**
   * Persist a single service entry to Redis.
   */
  private async persistToRedis(serviceId: string, entry: ServiceRegistryEntry): Promise<void> {
    if (!this.redis) return;
    await this.redis.hset(REDIS_REGISTRY_KEY, serviceId, JSON.stringify(entry));
  }

  /**
   * Remove a single service entry from Redis.
   */
  private async removeFromRedis(serviceId: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.hdel(REDIS_REGISTRY_KEY, serviceId);
  }
}
