// =============================================================================
// src/auth/descope.service.ts — Descope authentication & authorization service
// =============================================================================
// NestJS injectable service wrapping the Descope SDK.
//
// REPLACES: Express DescopeAuth class singleton
// NestJS ADVANTAGE: Service is injected via DI, making it testable and
// replaceable. No global singletons.
//
// Responsibilities:
//  1. Token Validation — Validates Bearer JWTs via Descope SDK
//  2. M2M Token Issuance — Issues scoped JWTs for services
//  3. Scope-Based Authorization — Checks caller scopes against registry
//  4. Token Refresh — Refreshes expiring tokens
// =============================================================================

import { Injectable } from '@nestjs/common';
import DescopeClient from '@descope/node-sdk';
import { ConfigService } from '../config/config.service';
import { LoggerService } from '../shared/logger.service';
import { ForbiddenError, UnauthorizedError } from '../shared/errors';
import { AuthenticatedRequest } from '../types';

@Injectable()
export class DescopeService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly management: any;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.client = DescopeClient({ projectId: this.config.descope.projectId });
    this.management = DescopeClient({
      projectId: this.config.descope.projectId,
      managementKey: this.config.descope.managementKey,
    });
  }

  /**
   * Validate a Bearer token and return the decoded session.
   * Used by the DescopeGuard.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async validateToken(token: string): Promise<any> {
    return this.client.validateSession(token);
  }

  /**
   * Issue a scoped JWT for a specific service using Descope's M2M flow.
   *
   * @param serviceId   — The service requesting a token
   * @param permissions — Descope permission strings to embed
   * @param scopes      — Service scopes to embed (from registry)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async issueToken(serviceId: string, permissions: string[] = [], scopes: string[] = []): Promise<any> {
    const loginOptions = {
      customClaims: { tribeId: serviceId, permissions, scopes },
    };

    const resp = await this.management.flow.start('m2m-tribe-token', {
      loginId: serviceId,
      ...loginOptions,
    });

    return resp.data;
  }

  /**
   * Authorize — check if the request has a specific permission.
   */
  async authorize(req: AuthenticatedRequest, requiredPermission: string): Promise<void> {
    const permissions = req.user?.token?.permissions || [];
    if (!permissions.includes(requiredPermission)) {
      throw new ForbiddenError(`Missing permission: '${requiredPermission}'`);
    }
  }

  /**
   * Policy-based auth: check if the caller's JWT has ALL required scopes.
   * Returns array of missing scopes (empty if all present).
   */
  checkScopes(req: AuthenticatedRequest, requiredScopes: string[]): string[] {
    const callerScopes = req.user?.token?.scopes || req.user?.token?.permissions || [];
    return requiredScopes.filter((scope) => !callerScopes.includes(scope));
  }

  /**
   * Refresh a token using Descope SDK.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async refreshToken(refreshToken: string): Promise<any> {
    return this.client.refresh(refreshToken);
  }
}
