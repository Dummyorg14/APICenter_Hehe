// =============================================================================
// src/external/apis/payment.ts — Payment API Configuration
// =============================================================================

import { ExternalApiConfig } from '../../types';

export const paymentApi: ExternalApiConfig = {
  name: 'payment',
  displayName: 'Payment Gateway',
  baseUrl: process.env.PAYMENT_API_URL || 'https://api.stripe.com/v1',
  authType: 'bearer',
  authHeader: 'Authorization',
  authValue: process.env.PAYMENT_API_KEY || '',
  timeout: 30_000,
  rateLimit: { windowMs: 60_000, max: 200 },
  healthEndpoint: '/health',
};
