// =============================================================================
// src/registry/registry.controller.ts — Service Registry API endpoints
// =============================================================================
// NestJS controller for managing the Dynamic Service Registry.
//
// REPLACES: Express registryRouter (routes.ts)
// NestJS ADVANTAGE: @UseGuards(PlatformAdminGuard) replaces the manual
// requirePlatformAdmin middleware. DTOs are auto-validated by the global
// ValidationPipe.
//
// ENDPOINTS:
//  POST   /api/v1/registry/register          — Register a new service
//  GET    /api/v1/registry/services           — List all services
//  GET    /api/v1/registry/services/:serviceId — Get a specific service
//  DELETE /api/v1/registry/services/:serviceId — Deregister a service
// =============================================================================

import { Controller, Post, Get, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { RegistryService } from './registry.service';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { LoggerService } from '../shared/logger.service';
import { ServiceManifestDto } from '../shared/dto/service-manifest.dto';
import { NotFoundError } from '../shared/errors';
import { AuthenticatedRequest } from '../types';

@Controller('registry')
@UseGuards(PlatformAdminGuard)
export class RegistryController {
  constructor(
    private readonly registry: RegistryService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * POST /api/v1/registry/register
   */
  @Post('register')
  register(@Body() dto: ServiceManifestDto, @Req() req: AuthenticatedRequest) {
    const manifest = {
      ...dto,
      consumes: dto.consumes ?? [],
    };
    const entry = this.registry.register(manifest);

    this.logger.info('Service registered via API', {
      serviceId: entry.serviceId,
      correlationId: req.correlationId,
    });

    return {
      success: true,
      data: entry,
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }

  /**
   * GET /api/v1/registry/services
   */
  @Get('services')
  listServices() {
    const all = this.registry.getAll();

    return {
      success: true,
      data: Object.values(all).map((svc) => ({
        serviceId: svc.serviceId,
        name: svc.name,
        baseUrl: svc.baseUrl,
        status: svc.status,
        exposes: svc.exposes,
        requiredScopes: svc.requiredScopes,
        consumes: svc.consumes,
        version: svc.version,
        registeredAt: svc.registeredAt,
        updatedAt: svc.updatedAt,
      })),
      meta: {
        total: this.registry.count(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * GET /api/v1/registry/services/:serviceId
   */
  @Get('services/:serviceId')
  getService(@Param('serviceId') serviceId: string) {
    const entry = this.registry.get(serviceId);
    if (!entry) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }

    return {
      success: true,
      data: entry,
      meta: { timestamp: new Date().toISOString() },
    };
  }

  /**
   * DELETE /api/v1/registry/services/:serviceId
   */
  @Delete('services/:serviceId')
  deregister(@Param('serviceId') serviceId: string, @Req() req: AuthenticatedRequest) {
    this.registry.deregister(serviceId);

    this.logger.info('Service deregistered via API', {
      serviceId,
      correlationId: req.correlationId,
    });

    return {
      success: true,
      data: { serviceId, message: `Service '${serviceId}' has been deregistered` },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    };
  }
}
