// =============================================================================
// src/shared-services/shared-services.controller.ts — Shared Platform Services Proxy
// =============================================================================
// Routes /api/v1/shared/:serviceId/* to platform-owned shared services
// (e.g., payment, email, SMS) that are registered via the service registry
// with serviceType: 'shared'.
//
// Uses the same ProxyHandler utility as TribesController to avoid duplication
// of proxy creation, lifecycle gating, scope checking, and metrics recording.
// =============================================================================

import {
  Controller,
  Get,
  All,
  Req,
  Res,
  Param,
  UseGuards,
  OnModuleDestroy,
} from '@nestjs/common';
import { Response } from 'express';
import { RegistryService } from '../registry/registry.service';
import { DescopeAuthGuard } from '../auth/guards/descope-auth.guard';
import { DescopeService } from '../auth/descope.service';
import { LoggerService } from '../shared/logger.service';
import { MetricsService } from '../metrics/metrics.service';
import { ProxyHandler } from '../shared/proxy-handler';
import { AuthenticatedRequest } from '../types';

@Controller('shared')
@UseGuards(DescopeAuthGuard)
export class SharedServicesController implements OnModuleDestroy {
  private readonly handler: ProxyHandler;

  constructor(
    registry: RegistryService,
    descope: DescopeService,
    logger: LoggerService,
    metrics: MetricsService,
  ) {
    this.handler = new ProxyHandler(
      { registry, descope, logger, metrics },
      { namespace: 'shared', pathPrefix: '/api/v1/shared' },
    );
  }

  onModuleDestroy() {
    this.handler.destroy();
  }

  // ─── List shared platform services ───────────────────────────────────────────
  @Get()
  listSharedServices(@Req() req: AuthenticatedRequest) {
    const tribeId = req.tribeId;
    const services = this.handler.listServices(tribeId);

    return {
      success: true,
      data: services,
      meta: {
        total: services.length,
        tribeId,
        namespace: 'shared',
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }

  // ─── Dynamic Proxy to shared services ────────────────────────────────────────
  @All(':serviceId/*')
  async proxy(
    @Param('serviceId') serviceId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    await this.handler.proxyRequest(serviceId, req, res);
  }
}
