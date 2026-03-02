// =============================================================================
// src/external/apis/index.ts — External API Config Barrel
// =============================================================================

import { ExternalApiConfigMap } from '../../types';
import { geolocationApi } from './geolocation';
import { geofencingApi } from './geofencing';
import { paymentApi } from './payment';
import { smsApi } from './sms';
import { emailApi } from './email';

export const externalApis: ExternalApiConfigMap = {
  geolocation: geolocationApi,
  geofencing: geofencingApi,
  payment: paymentApi,
  sms: smsApi,
  email: emailApi,
};

export { geolocationApi, geofencingApi, paymentApi, smsApi, emailApi };
