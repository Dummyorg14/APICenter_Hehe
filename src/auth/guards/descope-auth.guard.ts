// =============================================================================
// src/auth/guards/descope-auth.guard.ts — JWT authentication guard
// =============================================================================
// NestJS guard that validates the incoming Bearer JWT via Descope.
//
// REPLACES: Express descopeAuth.middleware()
// NestJS ADVANTAGE: Guards run AFTER middleware but BEFORE interceptors,
// pipes, and the controller. They return true/false to allow/deny access.
// They support DI and can be applied globally, per-controller, or per-route.
// =============================================================================

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { DescopeService } from '../descope.service';
import { LoggerService } from '../../shared/logger.service';
import { UnauthorizedError } from '../../shared/errors';
import { AuthenticatedRequest } from '../../types';

@Injectable()
export class DescopeAuthGuard implements CanActivate {
  constructor(
    private readonly descope: DescopeService,
    private readonly logger: LoggerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers.authorization?.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('Missing authorization token');
    }

    try {
      const authInfo = await this.descope.validateToken(token);
      (request as AuthenticatedRequest).user = authInfo;
      (request as AuthenticatedRequest).tribeId = authInfo?.token?.tribeId;
      return true;
    } catch (_err) {
      this.logger.warn(
        `Token validation failed from ${request.ip} on ${request.path}`,
        'DescopeAuthGuard',
      );
      throw new UnauthorizedError('Invalid or expired token');
    }
  }
}
