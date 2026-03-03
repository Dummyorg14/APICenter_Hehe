// =============================================================================
// src/shared/proxy-handler.ts — Reusable proxy utility
// =============================================================================
// Extracted from TribesController so both /tribes/* and /shared/* controllers
// can compose the same proxy creation, lifecycle gating, scope checking, and
// metrics recording without code duplication.
// =============================================================================

import { Response } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { RegistryService } from '../registry/registry.service';
import { DescopeService } from '../auth/descope.service';
import { LoggerService } from '../shared/logger.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  ForbiddenError,
  NotFoundError,
  BadGatewayError,
} from '../shared/errors';
import { AuthenticatedRequest, ServiceType } from '../types';

/** HTTP 410 Gone — service has been retired */
export class GoneError extends NotFoundError {
  constructor(message: string) {
    super(message);
    Object.defineProperty(this, 'status', { value: 410 });
  }
}

export interface ProxyHandlerDeps {
  registry: RegistryService;
  descope: DescopeService;
  logger: LoggerService;
  metrics: MetricsService;
}

export interface ProxyOptions {
  /** Route namespace for this proxy — 'shared' or 'tribe' */
  namespace: ServiceType;
  /** The URL prefix to strip, e.g. '/api/v1/tribes' or '/api/v1/shared' */
  pathPrefix: string;
}

/**
 * Reusable proxy handler that both TribesController and SharedServicesController
 * compose for dynamic upstream proxying with lifecycle gating & scope checks.
 */
export class ProxyHandler {
  private readonly proxyCache = new Map<string, ReturnType<typeof createProxyMiddleware>>();

  constructor(
    private readonly deps: ProxyHandlerDeps,
    private readonly opts: ProxyOptions,
  ) {}

  /** Clear the proxy cache (call from onModuleDestroy). */
  destroy(): void {
    this.proxyCache.clear();
  }

  /**
   * List services visible to a caller, filtered by this handler's namespace.
   */
  listServices(tribeId: string | undefined) {
    const services = this.deps.registry.getByType(this.opts.namespace);

    return services
      .filter((svc) => svc.status !== 'retired')
      .map((svc) => ({
        serviceId: svc.serviceId,
        name: svc.name,
        status: svc.status,
        version: svc.version,
        exposes: svc.exposes,
        serviceType: svc.serviceType ?? 'tribe',
        canAccess: tribeId
          ? this.deps.registry.canConsume(tribeId, svc.serviceId)
          : false,
        ...(svc.status === 'deprecated' && {
          deprecated: true,
          sunsetDate: svc.sunsetDate,
          replacementService: svc.replacementService,
        }),
      }));
  }

  /**
   * Proxy a request to a registered upstream service.
   * Validates namespace, lifecycle status, scope constraints, then forwards.
   */
  async proxyRequest(
    targetServiceId: string,
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const tribeId = req.tribeId!;
    const correlationId = req.correlationId;

    // ── 1. Resolve upstream ────────────────────────────────────────────────
    const upstream = this.deps.registry.resolveUpstream(targetServiceId, '');
    if (!upstream) {
      throw new NotFoundError(
        `Service '${targetServiceId}' not found or inactive`,
      );
    }

    // ── 1b. Validate namespace ─────────────────────────────────────────────
    const targetEntry = this.deps.registry.get(targetServiceId);
    const targetType = targetEntry?.serviceType ?? 'tribe';
    if (targetType !== this.opts.namespace) {
      const correctPrefix = targetType === 'shared' ? '/shared/' : '/tribes/';
      throw new NotFoundError(
        `Service '${targetServiceId}' is a ${targetType} service. Use ${correctPrefix}${targetServiceId} instead.`,
      );
    }

    // ── 1c. Lifecycle gate ─────────────────────────────────────────────────
    this.enforceLifecycleGate(targetEntry, targetServiceId, res);

    // ── 2. Scope check ─────────────────────────────────────────────────────
    if (!this.deps.registry.canConsume(tribeId, targetServiceId)) {
      throw new ForbiddenError(
        `Tribe '${tribeId}' is not authorised to consume '${targetServiceId}'`,
      );
    }

    const requiredScopes = this.deps.registry.getRequiredScopes(targetServiceId);
    if (requiredScopes.length > 0 && req.user) {
      const missingScopes = this.deps.descope.checkScopes(req, requiredScopes);
      if (missingScopes.length > 0) {
        throw new ForbiddenError(
          `Insufficient scopes for '${targetServiceId}'. Missing: ${missingScopes.join(', ')}`,
        );
      }
    }

    // ── 3. Get or create proxy ─────────────────────────────────────────────
    let proxy = this.proxyCache.get(targetServiceId);

    if (!proxy) {
      const proxyOpts: Options = {
        target: upstream,
        changeOrigin: true,
        pathRewrite: {
          [`^${this.opts.pathPrefix}/${targetServiceId}`]: '',
        },
        on: {
          proxyReq: (proxyReq, _req) => {
            const authReq = _req as AuthenticatedRequest;
            proxyReq.setHeader('X-Tribe-Id', authReq.tribeId || '');
            proxyReq.setHeader('X-Correlation-ID', authReq.correlationId || '');
            proxyReq.setHeader('X-Forwarded-By', 'apicenter-gateway');
          },
          error: (err) => {
            this.deps.logger.error(
              `Proxy error for ${targetServiceId}: ${err.message}`,
            );
          },
        },
        logger: {
          info: (msg: string) => this.deps.logger.debug(msg),
          warn: (msg: string) => this.deps.logger.warn(msg),
          error: (msg: string) => this.deps.logger.error(msg),
        },
      };

      proxy = createProxyMiddleware(proxyOpts);
      this.proxyCache.set(targetServiceId, proxy);

      this.deps.logger.info('Created proxy instance', {
        targetServiceId,
        upstream,
        namespace: this.opts.namespace,
        correlationId,
      });
    }

    // ── 4. Forward the request ─────────────────────────────────────────────
    const proxyStart = Date.now();

    res.on('finish', () => {
      const durationSec = (Date.now() - proxyStart) / 1000;
      this.deps.metrics.recordProxyRequest(
        this.opts.namespace,
        tribeId,
        targetServiceId,
        req.method,
        res.statusCode,
        durationSec,
      );
    });

    try {
      (proxy as any)(req, res, (err?: Error) => {
        if (err) {
          this.deps.logger.error(
            `Proxy callback error [${targetServiceId}]: ${err.message}`,
          );
          throw new BadGatewayError(
            `Upstream '${targetServiceId}' unreachable`,
          );
        }
      });
    } catch (error: any) {
      this.deps.logger.error(
        `Proxy throw error [${targetServiceId}]: ${error.message}`,
      );
      throw new BadGatewayError(`Upstream '${targetServiceId}' unreachable`);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Reject retired services (410) and set RFC 8594 deprecation headers. */
  private enforceLifecycleGate(
    entry: {
      status?: string;
      sunsetDate?: string;
      replacementService?: string;
    } | null | undefined,
    serviceId: string,
    res: Response,
  ): void {
    if (entry?.status === 'retired') {
      throw new GoneError(
        `Service '${serviceId}' has been retired` +
          (entry.replacementService
            ? `. Migrate to '${entry.replacementService}'`
            : ''),
      );
    }
    if (entry?.status === 'deprecated') {
      res.setHeader('Deprecation', 'true');
      if (entry.sunsetDate) {
        res.setHeader('Sunset', new Date(entry.sunsetDate).toUTCString());
      }
      if (entry.replacementService) {
        const nsPrefix = this.opts.namespace === 'shared' ? 'shared' : 'tribes';
        res.setHeader(
          'Link',
          `</api/v1/${nsPrefix}/${entry.replacementService}>; rel="successor-version"`,
        );
      }
    }
  }
}
