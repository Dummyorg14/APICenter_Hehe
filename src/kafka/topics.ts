// =============================================================================
// src/kafka/topics.ts — Centralized Kafka topic definitions
// =============================================================================
// Every Kafka topic used in the API Center is defined here.
// Using a central definition prevents typos and makes the full event
// taxonomy visible at a glance.
// =============================================================================

export const TOPICS = {
  // ---- API Gateway lifecycle events ----
  GATEWAY_REQUEST: 'api-center.gateway.request',
  GATEWAY_RESPONSE: 'api-center.gateway.response',
  GATEWAY_ERROR: 'api-center.gateway.error',

  // ---- Tribe-to-tribe communication ----
  TRIBE_REQUEST: 'api-center.tribe.request',
  TRIBE_RESPONSE: 'api-center.tribe.response',

  // ---- External API events ----
  EXTERNAL_REQUEST: 'api-center.external.request',

  // ---- Audit / Observability ----
  AUDIT_LOG: 'api-center.audit.log',

  // ---- Service Registry events ----
  SERVICE_REGISTERED: 'api-center.registry.service-registered',
  SERVICE_DEREGISTERED: 'api-center.registry.service-deregistered',
  SERVICE_DEPRECATED: 'api-center.registry.service-deprecated',
  SERVICE_RETIRED: 'api-center.registry.service-retired',
  SERVICE_VERSION_CHANGED: 'api-center.registry.service-version-changed',

  // ---- Reserved (not yet implemented — kept for future use) ----
  /** @reserved Cross-tribe pub/sub events (planned) */
  TRIBE_EVENT: 'api-center.tribe.event',
  /** @reserved External API response logging (planned) */
  EXTERNAL_RESPONSE: 'api-center.external.response',
  /** @reserved Inbound webhook forwarding (planned) */
  EXTERNAL_WEBHOOK: 'api-center.external.webhook',
  /** @reserved Auth lifecycle events (planned) */
  TOKEN_ISSUED: 'api-center.auth.token-issued',
  /** @reserved Auth lifecycle events (planned) */
  TOKEN_REVOKED: 'api-center.auth.token-revoked',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];
