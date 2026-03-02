// =============================================================================
// src/registry/registry.module.ts — Registry NestJS Module
// =============================================================================

import { Module } from '@nestjs/common';
import { RegistryService } from './registry.service';
import { RegistryController } from './registry.controller';

@Module({
  controllers: [RegistryController],
  providers: [RegistryService],
  exports: [RegistryService],
})
export class RegistryModule {}
