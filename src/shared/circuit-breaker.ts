// =============================================================================
// src/shared/circuit-breaker.ts — Circuit Breaker pattern
// =============================================================================
// Fault tolerance for external API calls in distributed systems.
//
// STATES:
//  CLOSED    → Normal operation. Requests pass through.
//  OPEN      → Too many failures. Requests are rejected instantly (fail-fast).
//  HALF_OPEN → After cooldown, one test request is allowed through.
// =============================================================================

import { LoggerService } from './logger.service';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  successThreshold?: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly successThreshold: number;
  private readonly logger: LoggerService;

  constructor(name: string, logger: LoggerService, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.logger = logger;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.successThreshold = options.successThreshold ?? 2;
  }

  getState(): CircuitState {
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        this.logger.log(`Circuit breaker [${this.name}] transitioning to HALF_OPEN`, 'CircuitBreaker');
      } else {
        throw new Error(`Circuit breaker [${this.name}] is OPEN — request rejected`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.logger.log(`Circuit breaker [${this.name}] CLOSED (recovered)`, 'CircuitBreaker');
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.logger.warn(`Circuit breaker [${this.name}] re-OPENED from HALF_OPEN`);
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.logger.warn(`Circuit breaker [${this.name}] OPENED after ${this.failureCount} failures`);
    }
  }

  getStats() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime
        ? new Date(this.lastFailureTime).toISOString()
        : null,
    };
  }
}
