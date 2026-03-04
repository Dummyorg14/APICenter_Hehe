// =============================================================================
// src/registry/registry.module.ts — Registry NestJS Module
// =============================================================================

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RegistryService } from './registry.service';
import { RegistryController } from './registry.controller';
import { HealthMonitorService } from './health-monitor.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [RegistryController],
  providers: [RegistryService, HealthMonitorService],
  exports: [RegistryService],
})
export class RegistryModule {}
