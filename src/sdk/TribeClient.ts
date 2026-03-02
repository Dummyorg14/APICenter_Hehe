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
//   const users = await client.callService('user-service', '/users');
// =============================================================================

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export interface TribeClientOptions {
  /** Base URL of the APICenter gateway (e.g. http://localhost:4000) */
  gatewayUrl: string;
  /** Your tribe's service identifier */
  tribeId: string;
  /** The shared secret (env-provisioned) for M2M token issuance */
  secret: string;
  /** Optional timeout in ms (default 30 000) */
  timeout?: number;
}

export class TribeClient {
  private readonly http: AxiosInstance;
  private readonly tribeId: string;
  private readonly secret: string;

  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(opts: TribeClientOptions) {
    this.tribeId = opts.tribeId;
    this.secret = opts.secret;

    this.http = axios.create({
      baseURL: opts.gatewayUrl,
      timeout: opts.timeout ?? 30_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── Authentication ──────────────────────────────────────────────────────────
  /** Obtain an M2M access token from the gateway */
  async authenticate(): Promise<void> {
    const res = await this.http.post('/api/v1/auth/token', {
      tribeId: this.tribeId,
      secret: this.secret,
    });

    const data = res.data?.data;
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken ?? null;
    this.tokenExpiry = Date.now() + (data.expiresIn ?? 3_600) * 1_000;
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

  // ─── Service Calls ───────────────────────────────────────────────────────────
  /**
   * Call a registered tribe service through the gateway proxy.
   *
   * @param serviceId  - The target service identifier (e.g. 'user-service')
   * @param path       - The downstream path  (e.g. '/users/123')
   * @param options    - Optional Axios request config overrides
   */
  async callService(serviceId: string, path: string, options?: AxiosRequestConfig) {
    await this.ensureAuth();

    const res = await this.http.request({
      ...options,
      method: options?.method ?? 'GET',
      url: `/api/v1/tribes/${serviceId}${path}`,
      headers: {
        ...(options?.headers ?? {}),
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    return res.data;
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

    const res = await this.http.request({
      ...options,
      method: options?.method ?? 'GET',
      url: `/api/v1/external/${apiName}${path}`,
      headers: {
        ...(options?.headers ?? {}),
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    return res.data;
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────
  /** List all services visible to the current tribe */
  async listServices() {
    await this.ensureAuth();
    const res = await this.http.get('/api/v1/tribes', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    return res.data;
  }

  /** Get current access token (for manual use) */
  getAccessToken(): string | null {
    return this.accessToken;
  }
}
