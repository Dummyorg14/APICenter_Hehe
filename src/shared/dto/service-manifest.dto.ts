// =============================================================================
// src/shared/dto/service-manifest.dto.ts — DTO for service registration
// =============================================================================
// Validates service registration manifests using class-validator decorators.
// Replaces the Zod serviceManifestSchema from the Express version.
// =============================================================================

import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsUrl,
  IsArray,
  ArrayMinSize,
  IsOptional,
  Matches,
} from 'class-validator';

export class ServiceManifestDto {
  @IsString()
  @IsNotEmpty({ message: 'serviceId is required' })
  @MaxLength(64, { message: 'serviceId is too long' })
  @Matches(/^[a-z0-9-]+$/, {
    message: 'serviceId must be lowercase alphanumeric with hyphens only',
  })
  serviceId: string;

  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(128, { message: 'name is too long' })
  name: string;

  @IsString()
  @IsUrl({}, { message: 'baseUrl must be a valid URL' })
  baseUrl: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one required scope must be defined' })
  @IsString({ each: true })
  requiredScopes: string[];

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one exposed route must be defined' })
  @IsString({ each: true })
  exposes: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  consumes?: string[] = [];

  @IsString()
  @IsOptional()
  healthCheck?: string;

  @IsString()
  @IsOptional()
  version?: string;

  @IsString()
  @MaxLength(500, { message: 'description is too long' })
  @IsOptional()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
