// =============================================================================
// src/types/index.ts — Shared TypeScript type definitions for the API Center
// =============================================================================
// All shared interfaces and types used across the application are defined here.
// Import from '../types' in other modules.
//
// NESTJS NOTE: In NestJS, we use DTOs (Data Transfer Objects) with
// class-validator decorators for request validation instead of Zod.
// However, these interfaces remain useful for internal typing.
// =============================================================================

import { Request } from 'express';

// ---------------------------------------------------------------------------
// Express request extensions (used inside NestJS's Express adapter)
// ---------------------------------------------------------------------------

/**
 * Extended Express Request that includes service authentication info
 * and distributed tracing fields.
 * After Descope middleware validates the JWT, these fields are attached.
 */
export interface AuthenticatedRequest extends Request {
  /** Decoded Descope session data (JWT claims) */
  user?: DescopeSession;
  /** The service/tribe ID extracted from the JWT's custom claims */
  tribeId?: string;
  /** Unique correlation ID for distributed request tracing */
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Descope / Authentication types
// ---------------------------------------------------------------------------

/** Decoded Descope session attached to req.user after token validation */
export interface DescopeSession {
  token?: {
    tribeId?: string;
    permissions?: string[];
    scopes?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Response returned when a service token is successfully issued */
export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  tribeId: string;
  permissions: string[];
  scopes: string[];
}

// ---------------------------------------------------------------------------
// Service Registry types (Dynamic Service Registry)
// ---------------------------------------------------------------------------

/**
 * A service manifest is what a tribe/service sends when registering
 * with the API Center via POST /api/v1/registry/register.
 */
export interface ServiceManifest {
  serviceId: string;
  name: string;
  baseUrl: string;
  requiredScopes: string[];
  exposes: string[];
  consumes: string[];
  healthCheck?: string;
  version?: string;
  description?: string;
  tags?: string[];
}

/**
 * A registry entry extends ServiceManifest with platform-managed metadata.
 */
export interface ServiceRegistryEntry extends ServiceManifest {
  registeredAt: string;
  updatedAt: string;
  status: 'active' | 'inactive' | 'degraded';
}

/** Map of service ID → ServiceRegistryEntry */
export interface ServiceRegistryMap {
  [serviceId: string]: ServiceRegistryEntry;
}

// ---------------------------------------------------------------------------
// Legacy Tribe types (kept for backwards compatibility)
// ---------------------------------------------------------------------------

export interface TribeConfig {
  name: string;
  baseUrl: string;
  permissions: string[];
  exposes: string[];
  consumes: string[];
}

export interface TribeConfigMap {
  [tribeId: string]: TribeConfig;
}

// ---------------------------------------------------------------------------
// External API types
// ---------------------------------------------------------------------------

export type ExternalAuthType = 'bearer' | 'api-key' | 'basic' | 'apiKey';

export interface ExternalApiConfig {
  name: string;
  displayName: string;
  baseUrl: string;
  authType: ExternalAuthType;
  authHeader: string;
  authValue: string;
  timeout: number;
  rateLimit?: { windowMs: number; max: number };
  healthEndpoint?: string;
  description?: string;
}

export interface ExternalApiConfigMap {
  [apiName: string]: ExternalApiConfig;
}

export interface ExternalCallOptions {
  method?: string;
  path?: string;
  query?: Record<string, string>;
  body?: unknown;
  data?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  timeout?: number;
  tribeId?: string;
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Kafka types
// ---------------------------------------------------------------------------

export interface KafkaMessageMeta {
  timestamp: string;
  source: string;
  correlationId?: string;
}

export interface AuditLogEvent {
  tribeId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string;
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// API Response envelope (standardized response shape)
// ---------------------------------------------------------------------------

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: {
    timestamp: string;
    correlationId?: string;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    correlationId?: string;
  };
}
