// =============================================================================
// src/sdk/TribeClient.ts — Standalone SDK for registered Tribe services
// =============================================================================
// This file is NOT part of the NestJS DI container — it's a standalone HTTP
// client that Tribe microservices use to communicate with the APICenter
// gateway.  It is exported from the package (see package.json "exports").
//
// UNCHANGED from the Express version — the SDK is framework-agnostic; it only
// speaks HTTP to the gateway's public REST endpoints.
//
// RESILIENCE:
//  - Automatic retries with exponential backoff for network failures / 5xx.
//  - Typed error classes so consumers get clean, descriptive exceptions.
//
// USAGE (from a Tribe microservice):
//
//   import { TribeClient } from '@apicenter/sdk';
//
//   const client = new TribeClient({
//     gatewayUrl: 'http://localhost:4000',
//     tribeId:    'my-tribe',
//     secret:     process.env.MY_TRIBE_SECRET!,
//   });
//
//   await client.authenticate();
//   const users  = await client.callService('user-service', '/users');
//   const shared = await client.callSharedService('email-service', '/send');
// =============================================================================

import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosError,
  isAxiosError,
} from 'axios';

// ---------------------------------------------------------------------------
// SDK Error hierarchy
// ---------------------------------------------------------------------------

/** Base error for every SDK-thrown exception. */
export class TribeClientError extends Error {
  /** HTTP status code returned by the gateway (if any). */
  public readonly statusCode?: number;
  /** Machine-readable error code (e.g. 'GATEWAY_TIMEOUT'). */
  public readonly code: string;

  constructor(message: string, code: string, statusCode?: number) {
    super(message);
    this.name = 'TribeClientError';
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401 — Credentials were rejected or the token has expired. */
export class AuthenticationError extends TribeClientError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

/** 403 — Caller lacks required scopes / permissions. */
export class AuthorizationError extends TribeClientError {
  constructor(message = 'Forbidden — insufficient scopes') {
    super(message, 'AUTHORIZATION_ERROR', 403);
    this.name = 'AuthorizationError';
  }
}

/** 404 — The target service or resource does not exist. */
export class ServiceNotFoundError extends TribeClientError {
  constructor(serviceId?: string) {
    super(
      serviceId
        ? `Service '${serviceId}' not found in the gateway registry`
        : 'Resource not found',
      'SERVICE_NOT_FOUND',
      404,
    );
    this.name = 'ServiceNotFoundError';
  }
}

/** 429 — Rate limit exceeded. */
export class RateLimitError extends TribeClientError {
  public readonly retryAfterMs?: number;

  constructor(retryAfterMs?: number) {
    super('Rate limit exceeded — slow down and retry', 'RATE_LIMIT_EXCEEDED', 429);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** 504 / ETIMEDOUT — The upstream service timed out. */
export class GatewayTimeoutError extends TribeClientError {
  constructor(message = 'Gateway or upstream timed out') {
    super(message, 'GATEWAY_TIMEOUT', 504);
    this.name = 'GatewayTimeoutError';
  }
}

/** 502 — The upstream service is unreachable or returned a bad response. */
export class BadGatewayError extends TribeClientError {
  constructor(message = 'Upstream service unreachable') {
    super(message, 'BAD_GATEWAY', 502);
    this.name = 'BadGatewayError';
  }
}

/** 503 — Service temporarily unavailable (circuit breaker open, etc.). */
export class ServiceUnavailableError extends TribeClientError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 'SERVICE_UNAVAILABLE', 503);
    this.name = 'ServiceUnavailableError';
  }
}

/** Network-level failure — DNS, ECONNREFUSED, socket hang up, etc. */
export class NetworkError extends TribeClientError {
  constructor(message = 'Network error — could not reach the gateway') {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

/** Status codes that are safe to retry (transient server errors). */
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

/** Axios error codes that indicate a network-level failure. */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'ERR_NETWORK',
]);

function isRetryable(error: AxiosError): boolean {
  if (error.response && RETRYABLE_STATUS_CODES.has(error.response.status)) {
    return true;
  }
  if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) {
    return true;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * Translate an Axios error into a typed SDK error.
 * Falls back to generic `TribeClientError` for unmapped status codes.
 */
function wrapAxiosError(err: AxiosError): TribeClientError {
  const status = err.response?.status;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = err.response?.data as any;
  const detail = body?.error?.message ?? body?.message ?? err.message;

  if (!err.response) {
    // Network / timeout error — no HTTP response received
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return new GatewayTimeoutError(detail);
    }
    return new NetworkError(detail);
  }

  switch (status) {
    case 401:
      return new AuthenticationError(detail);
    case 403:
      return new AuthorizationError(detail);
    case 404:
      return new ServiceNotFoundError();
    case 429: {
      const retryAfter = Number(err.response.headers?.['retry-after']) || undefined;
      return new RateLimitError(retryAfter ? retryAfter * 1000 : undefined);
    }
    case 502:
      return new BadGatewayError(detail);
    case 503:
      return new ServiceUnavailableError(detail);
    case 504:
      return new GatewayTimeoutError(detail);
    default:
      return new TribeClientError(detail, 'GATEWAY_ERROR', status);
  }
}

// ---------------------------------------------------------------------------
// SDK Options
// ---------------------------------------------------------------------------

export interface TribeClientOptions {
  /** Base URL of the APICenter gateway (e.g. http://localhost:4000) */
  gatewayUrl: string;
  /** Your tribe's service identifier */
  tribeId: string;
  /** The shared secret (env-provisioned) for M2M token issuance */
  secret: string;
  /** Optional timeout in ms (default 30 000) */
  timeout?: number;
  /** Max retry attempts for transient failures (default 3) */
  maxRetries?: number;
  /** Initial delay between retries in ms — doubles each attempt (default 500) */
  retryBaseDelayMs?: number;
}

// ---------------------------------------------------------------------------
// SDK Client
// ---------------------------------------------------------------------------

export class TribeClient {
  private readonly http: AxiosInstance;
  private readonly tribeId: string;
  private readonly secret: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(opts: TribeClientOptions) {
    this.tribeId = opts.tribeId;
    this.secret = opts.secret;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 500;

    this.http = axios.create({
      baseURL: opts.gatewayUrl,
      timeout: opts.timeout ?? 30_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── Authentication ──────────────────────────────────────────────────────────
  /** Obtain an M2M access token from the gateway */
  async authenticate(): Promise<void> {
    try {
      const res = await this.http.post('/api/v1/auth/token', {
        tribeId: this.tribeId,
        secret: this.secret,
      });

      const data = res.data?.data;
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken ?? null;
      this.tokenExpiry = Date.now() + (data.expiresIn ?? 3_600) * 1_000;
    } catch (err) {
      throw isAxiosError(err) ? wrapAxiosError(err) : err;
    }
  }

  /** Refresh using the stored refresh token */
  async refresh(): Promise<void> {
    if (!this.refreshToken) {
      return this.authenticate();
    }

    try {
      const res = await this.http.post('/api/v1/auth/token/refresh', {
        refreshToken: this.refreshToken,
      });

      const data = res.data?.data;
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken ?? this.refreshToken;
      this.tokenExpiry = Date.now() + (data.expiresIn ?? 3_600) * 1_000;
    } catch {
      // If refresh fails, fall back to full auth
      return this.authenticate();
    }
  }

  /** Ensure a valid access token is available (auto-refresh) */
  private async ensureAuth(): Promise<void> {
    if (!this.accessToken || Date.now() >= this.tokenExpiry - 30_000) {
      if (this.refreshToken) {
        await this.refresh();
      } else {
        await this.authenticate();
      }
    }
  }

  // ─── Retryable request wrapper ───────────────────────────────────────────────

  /**
   * Execute an Axios request with automatic retries and exponential backoff
   * for transient (5xx / network) failures.  Non-retryable errors are thrown
   * immediately as typed SDK errors.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async requestWithRetry(config: AxiosRequestConfig): Promise<any> {
    let lastError: AxiosError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.http.request(config);
        return res.data;
      } catch (err) {
        if (!isAxiosError(err)) throw err;

        lastError = err;

        // Only retry on transient failures
        if (!isRetryable(err) || attempt === this.maxRetries) {
          throw wrapAxiosError(err);
        }

        // Exponential backoff with jitter: baseDelay * 2^attempt ± 25 %
        const base = this.retryBaseDelayMs * Math.pow(2, attempt);
        const jitter = base * 0.25 * (Math.random() * 2 - 1); // ±25 %
        const delay = Math.max(0, Math.round(base + jitter));

        await sleep(delay);
      }
    }

    // Should never reach here, but satisfy the compiler
    throw lastError ? wrapAxiosError(lastError) : new NetworkError();
  }

  // ─── Service Calls ───────────────────────────────────────────────────────────
  /**
   * Call a registered **tribe** service through the gateway proxy.
   *
   * @param serviceId  - The target service identifier (e.g. 'user-service')
   * @param path       - The downstream path  (e.g. '/users/123')
   * @param options    - Optional Axios request config overrides
   */
  async callService(serviceId: string, path: string, options?: AxiosRequestConfig) {
    await this.ensureAuth();

    return this.requestWithRetry({
      ...options,
      method: options?.method ?? 'GET',
      url: `/api/v1/tribes/${serviceId}${path}`,
      headers: {
        ...(options?.headers ?? {}),
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
  }

  /**
   * Call a registered **shared** (platform) service through the gateway proxy.
   *
   * @param serviceId  - The target shared service identifier (e.g. 'email-service')
   * @param path       - The downstream path  (e.g. '/send')
   * @param options    - Optional Axios request config overrides
   */
  async callSharedService(serviceId: string, path: string, options?: AxiosRequestConfig) {
    await this.ensureAuth();

    return this.requestWithRetry({
      ...options,
      method: options?.method ?? 'GET',
      url: `/api/v1/shared/${serviceId}${path}`,
      headers: {
        ...(options?.headers ?? {}),
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
  }

  /**
   * Call an external API through the gateway proxy.
   *
   * @param apiName  - External API name (e.g. 'geolocation')
   * @param path     - The downstream path (e.g. '/lookup?ip=8.8.8.8')
   * @param options  - Optional Axios request config overrides
   */
  async callExternal(apiName: string, path: string, options?: AxiosRequestConfig) {
    await this.ensureAuth();

    return this.requestWithRetry({
      ...options,
      method: options?.method ?? 'GET',
      url: `/api/v1/external/${apiName}${path}`,
      headers: {
        ...(options?.headers ?? {}),
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────
  /** List all services visible to the current tribe */
  async listServices() {
    await this.ensureAuth();

    return this.requestWithRetry({
      method: 'GET',
      url: '/api/v1/tribes',
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }

  /** List all shared (platform) services visible to the current tribe */
  async listSharedServices() {
    await this.ensureAuth();

    return this.requestWithRetry({
      method: 'GET',
      url: '/api/v1/shared',
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }

  /** Get current access token (for manual use) */
  getAccessToken(): string | null {
    return this.accessToken;
  }
}
