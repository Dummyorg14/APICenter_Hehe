// =============================================================================
// src/registry/registry.service.ts — Dynamic Service Registry (NestJS)
// =============================================================================
// The heart of the "Dynamic Service Registry" platform. Services register
// themselves at runtime by POSTing a ServiceManifest.
//
// REPLACES: Express ServiceRegistry singleton
// NestJS ADVANTAGE: Managed by DI container, injected wherever needed,
// easily mockable in tests.
//
// STORAGE STRATEGY (layered):
//  1. In-memory Map  — hot cache for zero-latency lookups (primary)
//  2. Redis          — shared cache across instances (optional)
//  3. Supabase       — persistent source of truth (optional)
// =============================================================================

import { Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import { ServiceManifest, ServiceRegistryEntry, ServiceRegistryMap } from '../types';
import { LoggerService } from '../shared/logger.service';
import { NotFoundError } from '../shared/errors';

@Injectable()
export class RegistryService {
  private readonly services: ServiceRegistryMap = {};

  constructor(private readonly logger: LoggerService) {}

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a new service or update an existing one.
   */
  register(manifest: ServiceManifest): ServiceRegistryEntry {
    const now = new Date().toISOString();
    const existing = this.services[manifest.serviceId];

    const entry: ServiceRegistryEntry = {
      ...manifest,
      registeredAt: existing?.registeredAt || now,
      updatedAt: now,
      status: 'active',
    };

    this.services[manifest.serviceId] = entry;

    this.logger.info('Service registered', {
      serviceId: manifest.serviceId,
      name: manifest.name,
      baseUrl: manifest.baseUrl,
      exposes: manifest.exposes,
      isUpdate: !!existing,
    });

    return entry;
  }

  /**
   * Remove a service from the registry.
   */
  deregister(serviceId: string): void {
    const existing = this.services[serviceId];
    if (!existing) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }

    delete this.services[serviceId];
    this.logger.info('Service deregistered', { serviceId });
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
}
