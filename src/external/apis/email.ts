// =============================================================================
// src/external/apis/email.ts — Email API Configuration
// =============================================================================

import { ExternalApiConfig } from '../../types';

export const emailApi: ExternalApiConfig = {
  name: 'email',
  displayName: 'Email Service',
  baseUrl: process.env.EMAIL_API_URL || 'https://api.sendgrid.com/v3',
  authType: 'bearer',
  authHeader: 'Authorization',
  authValue: process.env.EMAIL_API_KEY || '',
  timeout: 15_000,
  rateLimit: { windowMs: 60_000, max: 100 },
  healthEndpoint: '/health',
};
