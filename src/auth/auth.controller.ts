// =============================================================================
// src/auth/auth.controller.ts — Token issuance & refresh endpoints
// =============================================================================
// NestJS controller for authentication endpoints.
//
// REPLACES: Express authRouter (tokenController.ts)
// NestJS ADVANTAGE: Controllers use decorators (@Post, @Body, @Req) for
// clean routing. The ValidationPipe auto-validates DTOs before the method
// executes. No manual try/catch needed — NestJS filters catch everything.
//
// IMPORTANT: Auth endpoints are NOT guarded by DescopeAuthGuard because
// services need to call /auth/token to GET a JWT in the first place.
// =============================================================================

import { Controller, Post, Body, Req } from '@nestjs/common';
import { DescopeService } from './descope.service';
import { RegistryService } from '../registry/registry.service';
import { LoggerService } from '../shared/logger.service';
import { KafkaService } from '../kafka/kafka.service';
import { TOPICS } from '../kafka/topics';
import { NotFoundError, UnauthorizedError } from '../shared/errors';
import { TokenRequestDto } from '../shared/dto/token-request.dto';
import { RefreshTokenDto } from '../shared/dto/refresh-token.dto';
import { AuthenticatedRequest } from '../types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly descope: DescopeService,
    private readonly registry: RegistryService,
    private readonly logger: LoggerService,
    private readonly kafka: KafkaService,
  ) {}

  /**
   * POST /api/v1/auth/token
   * Services call this endpoint with their credentials to receive a scoped JWT.
   */
  @Post('token')
  async issueToken(@Body() dto: TokenRequestDto, @Req() req: AuthenticatedRequest) {
    const { tribeId, secret } = dto;

    // Verify the service exists in the dynamic registry
    const service = this.registry.get(tribeId);
    if (!service) {
      throw new NotFoundError(`Unknown service: ${tribeId}`);
    }

    // Validate the service's secret
    const isValid = await this.registry.validateSecret(tribeId, secret);
    if (!isValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Build scopes: own + consumable targets' scopes
    const ownScopes = service.requiredScopes || [];
    const consumableScopes: string[] = [];
    for (const targetId of service.consumes) {
      const target = this.registry.get(targetId);
      if (target) {
        consumableScopes.push(...target.requiredScopes);
      }
    }
    const scopes = [...new Set([...ownScopes, ...consumableScopes])];

    // Legacy permissions (backwards compatibility)
    const permissions = [`tribe:${tribeId}:read`, `tribe:${tribeId}:write`, 'external:read'];

    // Issue a Descope JWT with permissions + scopes
    const token = await this.descope.issueToken(tribeId, permissions, scopes);

    this.logger.info('Token issued', {
      serviceId: tribeId,
      scopes,
      correlationId: req.correlationId,
    });

    // Emit auth lifecycle event (never includes raw JWT)
    this.kafka
      .publish(
        TOPICS.TOKEN_ISSUED,
        {
          tribeId,
          scopes,
          permissions,
          expiresIn: token.expiresIn,
          correlationId: req.correlationId,
          timestamp: new Date().toISOString(),
        },
        tribeId,
      )
      .catch((err) =>
        this.logger.error(
          `Failed to publish TOKEN_ISSUED event: ${(err as Error).message}`,
          (err as Error).stack,
          'AuthController',
        ),
      );

    return {
      success: true,
      data: {
        accessToken: token.sessionJwt,
        refreshToken: token.refreshJwt ?? null,
        expiresIn: token.expiresIn,
        tribeId,
        permissions,
        scopes,
      },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    };
  }

  /**
   * POST /api/v1/auth/token/refresh
   * Refresh an expiring service token.
   */
  @Post('token/refresh')
  async refreshToken(@Body() dto: RefreshTokenDto, @Req() req: AuthenticatedRequest) {
    const resp = await this.descope.refreshToken(dto.refreshToken);

    this.logger.info('Token refreshed', { correlationId: req.correlationId });

    return {
      success: true,
      data: {
        accessToken: resp.data.sessionJwt,
        refreshToken: resp.data.refreshJwt ?? null,
        expiresIn: resp.data.expiresIn,
      },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId },
    };
  }
}
