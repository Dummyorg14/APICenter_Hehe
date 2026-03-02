// =============================================================================
// src/config/config.module.ts — Configuration module
// =============================================================================
// Provides the ConfigService as a global singleton.
// Any module that needs config simply injects ConfigService.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';

@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
