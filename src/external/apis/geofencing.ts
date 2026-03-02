// =============================================================================
// src/external/apis/geofencing.ts — Geofencing API Configuration
// =============================================================================

import { ExternalApiConfig } from '../../types';

export const geofencingApi: ExternalApiConfig = {
  name: 'geofencing',
  displayName: 'Geofencing API',
  baseUrl: process.env.GEOFENCING_API_URL || 'https://api.geofencing.example.com',
  authType: 'bearer',
  authHeader: 'Authorization',
  authValue: process.env.GEOFENCING_API_KEY || '',
  timeout: 10_000,
  rateLimit: { windowMs: 60_000, max: 50 },
  healthEndpoint: '/health',
};
