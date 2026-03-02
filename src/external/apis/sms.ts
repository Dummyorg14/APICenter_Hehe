// =============================================================================
// src/external/apis/sms.ts — SMS API Configuration
// =============================================================================

import { ExternalApiConfig } from '../../types';

export const smsApi: ExternalApiConfig = {
  name: 'sms',
  displayName: 'SMS Service',
  baseUrl: process.env.SMS_API_URL || 'https://api.twilio.com/2010-04-01',
  authType: 'basic',
  authHeader: 'Authorization',
  authValue: process.env.SMS_API_KEY || '',
  timeout: 15_000,
  rateLimit: { windowMs: 60_000, max: 100 },
  healthEndpoint: '/',
};
