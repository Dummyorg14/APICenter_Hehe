// =============================================================================
// src/shared/middleware/security.middleware.ts — Security hardening
// =============================================================================
// NestJS middleware for request size limiting and sensitive header stripping.
// Runs BEFORE guards, interceptors, and pipes.
//
// REPLACES: Express security middleware (requestSizeLimiter, stripSensitiveHeaders, securityHeaders)
// =============================================================================

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from '../logger.service';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  private readonly maxSizeBytes = 5 * 1024 * 1024; // 5MB

  constructor(private readonly logger: LoggerService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // ---- Request size check ----
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > this.maxSizeBytes) {
      this.logger.warn(`Request too large: ${contentLength} bytes from ${req.ip}`, 'Security');
      res.status(413).json({
        success: false,
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request entity too large' },
      });
      return;
    }

    // ---- Strip sensitive headers ----
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');

    // ---- Security headers ----
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    next();
  }
}
