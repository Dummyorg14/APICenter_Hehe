// =============================================================================
// src/kafka/schemas/auth.schemas.ts — Auth lifecycle event schemas
// =============================================================================

import { z } from 'zod';

/**
 * TOKEN_ISSUED event — emitted after successful M2M token issuance.
 * Contains only metadata; the raw JWT is NEVER included in the event.
 */
export const TokenIssuedEventSchema = z.object({
  tribeId: z.string(),
  scopes: z.array(z.string()),
  permissions: z.array(z.string()),
  expiresIn: z.number(),
  correlationId: z.string().optional(),
  timestamp: z.string(),
});
export type TokenIssuedEvent = z.infer<typeof TokenIssuedEventSchema>;
