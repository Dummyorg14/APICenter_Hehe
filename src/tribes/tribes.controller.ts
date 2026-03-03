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
import { Response } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { RegistryService } from '../registry/registry.service';
import { DescopeAuthGuard } from '../auth/guards/descope-auth.guard';
import { DescopeService } from '../auth/descope.service';
import { LoggerService } from '../shared/logger.service';
import { MetricsService } from '../metrics/metrics.service';
import { ForbiddenError, NotFoundError, BadGatewayError } from '../shared/errors';
import { AuthenticatedRequest } from '../types';

/** HTTP 410 Gone — service has been retired */
class GoneError extends NotFoundError {
  constructor(message: string) {
    super(message);
    // Override status to 410
    Object.defineProperty(this, 'status', { value: 410 });
  }
}

@Controller('tribes')
@UseGuards(DescopeAuthGuard)
export class TribesController implements OnModuleDestroy {
  /** Cache proxy instances by serviceId to avoid re-creation */
  private readonly proxyCache = new Map<string, ReturnType<typeof createProxyMiddleware>>();

  constructor(
    private readonly registry: RegistryService,
    private readonly descope: DescopeService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleDestroy() {
    this.proxyCache.clear();
  }

  // ─── List available services ─────────────────────────────────────────────────
  @Get()
  listServices(@Req() req: AuthenticatedRequest) {
    const tribeId = req.tribeId;
    const all = this.registry.getAll();

    const visible = Object.values(all)
      .filter((svc) => svc.status !== 'retired')
      .map((svc) => ({
        serviceId: svc.serviceId,
        name: svc.name,
        status: svc.status,
        version: svc.version,
        exposes: svc.exposes,
        canAccess: tribeId ? this.registry.canConsume(tribeId, svc.serviceId) : false,
        ...(svc.status === 'deprecated' && {
          deprecated: true,
          sunsetDate: svc.sunsetDate,
          replacementService: svc.replacementService,
        }),
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

    // ── 1b. Lifecycle gate ────────────────────────────────────────────────────
    const targetEntry = this.registry.get(targetServiceId);
    this.enforceLifecycleGate(targetEntry, targetServiceId, res);

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
    const proxyStart = Date.now();
    try {
      (proxy as any)(req, res, (err?: Error) => {
        if (err) {
          this.logger.error(`Proxy callback error [${targetServiceId}]: ${err.message}`);
          throw new BadGatewayError(`Upstream '${targetServiceId}' unreachable`);
        }
      });
      // Record showback metrics (best-effort — res may not be finished yet for streaming)
      const durationSec = (Date.now() - proxyStart) / 1000;
      this.metrics.recordTribeRequest(
        tribeId,
        targetServiceId,
        req.method,
        res.statusCode || 200,
        durationSec,
      );
    } catch (error: any) {
      const durationSec = (Date.now() - proxyStart) / 1000;
      this.metrics.recordTribeRequest(tribeId, targetServiceId, req.method, 502, durationSec);
      this.logger.error(`Proxy throw error [${targetServiceId}]: ${error.message}`);
      throw new BadGatewayError(`Upstream '${targetServiceId}' unreachable`);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /** Reject retired services (410) and set RFC 8594 deprecation headers. */
  private enforceLifecycleGate(
    entry: { status?: string; sunsetDate?: string; replacementService?: string } | undefined,
    serviceId: string,
    res: Response,
  ): void {
    if (entry?.status === 'retired') {
      throw new GoneError(
        `Service '${serviceId}' has been retired` +
          (entry.replacementService ? `. Migrate to '${entry.replacementService}'` : ''),
      );
    }
    if (entry?.status === 'deprecated') {
      res.setHeader('Deprecation', 'true');
      if (entry.sunsetDate) {
        res.setHeader('Sunset', new Date(entry.sunsetDate).toUTCString());
      }
      if (entry.replacementService) {
        res.setHeader(
          'Link',
          `</api/v1/tribes/${entry.replacementService}>; rel="successor-version"`,
        );
      }
    }
  }
}
