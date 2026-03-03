// =============================================================================
// src/auth/auth.module.ts — Authentication module
// =============================================================================
// Provides Descope auth service, guards, and token controller.
// Guards are exported so other modules can inject them.
// =============================================================================

import { Module } from '@nestjs/common';
import { DescopeService } from './descope.service';
import { DescopeAuthGuard } from './guards/descope-auth.guard';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { ScopedAdminGuard } from './guards/scoped-admin.guard';
import { AuthController } from './auth.controller';
import { RegistryModule } from '../registry/registry.module';

@Module({
  imports: [RegistryModule],
  controllers: [AuthController],
  providers: [DescopeService, DescopeAuthGuard, PlatformAdminGuard, ScopedAdminGuard],
  exports: [DescopeService, DescopeAuthGuard, PlatformAdminGuard, ScopedAdminGuard],
})
export class AuthModule {}
