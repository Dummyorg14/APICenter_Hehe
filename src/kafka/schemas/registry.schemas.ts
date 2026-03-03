// =============================================================================
// src/kafka/schemas/registry.schemas.ts — Service registry event schemas
// =============================================================================

import { z } from 'zod';

export const RegistryServiceRegisteredEventSchema = z.object({
  serviceId: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  exposes: z.array(z.string()),
  isUpdate: z.boolean().optional(),
  timestamp: z.string().optional(),
});
export type RegistryServiceRegisteredEvent = z.infer<typeof RegistryServiceRegisteredEventSchema>;

export const RegistryServiceDeregisteredEventSchema = z.object({
  serviceId: z.string(),
  timestamp: z.string().optional(),
});
export type RegistryServiceDeregisteredEvent = z.infer<typeof RegistryServiceDeregisteredEventSchema>;

export const RegistryServiceDeprecatedEventSchema = z.object({
  serviceId: z.string(),
  sunsetDate: z.string().optional(),
  replacementService: z.string().optional(),
  timestamp: z.string().optional(),
});
export type RegistryServiceDeprecatedEvent = z.infer<typeof RegistryServiceDeprecatedEventSchema>;

export const RegistryServiceRetiredEventSchema = z.object({
  serviceId: z.string(),
  timestamp: z.string().optional(),
});
export type RegistryServiceRetiredEvent = z.infer<typeof RegistryServiceRetiredEventSchema>;

export const RegistryServiceVersionChangedEventSchema = z.object({
  serviceId: z.string(),
  previousVersion: z.string(),
  newVersion: z.string(),
  timestamp: z.string().optional(),
});
export type RegistryServiceVersionChangedEvent = z.infer<typeof RegistryServiceVersionChangedEventSchema>;
