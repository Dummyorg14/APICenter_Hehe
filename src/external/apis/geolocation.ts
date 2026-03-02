// =============================================================================
// src/external/apis/geolocation.ts — Geolocation API Configuration
// =============================================================================

import { ExternalApiConfig } from '../../types';

export const geolocationApi: ExternalApiConfig = {
  name: 'geolocation',
  displayName: 'Geolocation API',
  baseUrl: process.env.GEOLOCATION_API_URL || 'https://api.ipgeolocation.io',
  authType: 'apiKey',
  authHeader: 'apiKey',
  authValue: process.env.GEOLOCATION_API_KEY || '',
  timeout: 10_000,
  rateLimit: { windowMs: 60_000, max: 100 },
  healthEndpoint: '/',
};
