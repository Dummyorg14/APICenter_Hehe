// =============================================================================
// src/tribes/tribes.controller.ts — Dynamic Service Proxy Controller
// =============================================================================
// NestJS controller that replaces the old Express tribesRouter.
//
// REPLACES: Express tribesRouter (router.ts)
// NestJS ADVANTAGE: @UseGuards(DescopeAuthGuard) replaces the manual
// descopeAuth.middleware(). The http-proxy-middleware proxies are still used
// for efficient request forwarding to upstream microservices.
//
// ENDPOINTS:
//  GET /api/v1/tribes           — List available services for this tribe
//  ALL /api/v1/tribes/:target/* — Proxy to registered upstream service
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
import { Request, Response } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { RegistryService } from '../registry/registry.service';
import { DescopeAuthGuard } from '../auth/guards/descope-auth.guard';
import { DescopeService } from '../auth/descope.service';
import { LoggerService } from '../shared/logger.service';
import { ForbiddenError, NotFoundError, BadGatewayError } from '../shared/errors';
import { AuthenticatedRequest } from '../types';

@Controller('tribes')
@UseGuards(DescopeAuthGuard)
export class TribesController implements OnModuleDestroy {
  /** Cache proxy instances by serviceId to avoid re-creation */
  private readonly proxyCache = new Map<string, ReturnType<typeof createProxyMiddleware>>();

  constructor(
    private readonly registry: RegistryService,
    private readonly descope: DescopeService,
    private readonly logger: LoggerService,
  ) {}

  onModuleDestroy() {
    this.proxyCache.clear();
  }

  // ─── List available services ─────────────────────────────────────────────────
  @Get()
  listServices(@Req() req: AuthenticatedRequest) {
    const tribeId = req.tribeId;
    const all = this.registry.getAll();

    const visible = Object.values(all).map((svc) => ({
      serviceId: svc.serviceId,
      name: svc.name,
      status: svc.status,
      exposes: svc.exposes,
      canAccess: tribeId ? this.registry.canConsume(tribeId, svc.serviceId) : false,
    }));

    return {
      success: true,
      data: visible,
      meta: {
        total: visible.length,
        tribeId,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }

  // ─── Dynamic Proxy ───────────────────────────────────────────────────────────
  @All(':targetServiceId/*')
  async proxy(
    @Param('targetServiceId') targetServiceId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const tribeId = req.tribeId!;
    const correlationId = req.correlationId;

    // ── 1. Resolve upstream ──────────────────────────────────────────────────
    const upstream = this.registry.resolveUpstream(targetServiceId, '');
    if (!upstream) {
      throw new NotFoundError(`Service '${targetServiceId}' not found or inactive`);
    }

    // ── 2. Scope check ──────────────────────────────────────────────────────
    if (!this.registry.canConsume(tribeId, targetServiceId)) {
      throw new ForbiddenError(
        `Tribe '${tribeId}' is not authorised to consume '${targetServiceId}'`,
      );
    }

    const requiredScopes = this.registry.getRequiredScopes(targetServiceId);
    if (requiredScopes.length > 0 && req.user) {
      const missingScopes = this.descope.checkScopes(req, requiredScopes);
      if (missingScopes.length > 0) {
        throw new ForbiddenError(
          `Insufficient scopes for '${targetServiceId}'. Missing: ${missingScopes.join(', ')}`,
        );
      }
    }

    // ── 3. Get or create proxy ───────────────────────────────────────────────
    let proxy = this.proxyCache.get(targetServiceId);

    if (!proxy) {
      const proxyOpts: Options = {
        target: upstream,
        changeOrigin: true,
        pathRewrite: {
          [`^/api/v1/tribes/${targetServiceId}`]: '',
        },
        on: {
          proxyReq: (proxyReq, _req) => {
            const authReq = _req as AuthenticatedRequest;
            proxyReq.setHeader('X-Tribe-Id', authReq.tribeId || '');
            proxyReq.setHeader('X-Correlation-ID', authReq.correlationId || '');
            proxyReq.setHeader('X-Forwarded-By', 'apicenter-gateway');
          },
          error: (err, _req, _res) => {
            this.logger.error(`Proxy error for ${targetServiceId}: ${err.message}`);
          },
        },
        logger: {
          info: (msg: string) => this.logger.debug(msg),
          warn: (msg: string) => this.logger.warn(msg),
          error: (msg: string) => this.logger.error(msg),
        },
      };

      proxy = createProxyMiddleware(proxyOpts);
      this.proxyCache.set(targetServiceId, proxy);

      this.logger.info('Created proxy instance', { targetServiceId, upstream, correlationId });
    }

    // ── 4. Forward the request ───────────────────────────────────────────────
    try {
      (proxy as any)(req, res, (err?: Error) => {
        if (err) {
          this.logger.error(`Proxy callback error [${targetServiceId}]: ${err.message}`);
          throw new BadGatewayError(`Upstream '${targetServiceId}' unreachable`);
        }
      });
    } catch (error: any) {
      this.logger.error(`Proxy throw error [${targetServiceId}]: ${error.message}`);
      throw new BadGatewayError(`Upstream '${targetServiceId}' unreachable`);
    }
  }
}
