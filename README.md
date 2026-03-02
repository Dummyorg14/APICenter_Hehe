# API Center — Dynamic Service Registry & Gateway

> Central API Gateway built with **NestJS**, **Kafka (KRaft)**, and **Descope** authentication.
> Routes, authenticates, and manages all inter-service and external API traffic through a single entry point.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Getting Started](#getting-started)
6. [Environment Variables](#environment-variables)
7. [API Endpoints](#api-endpoints)
8. [NestJS Module System](#nestjs-module-system)
9. [Authentication & Authorization](#authentication--authorization)
10. [Dynamic Service Registry](#dynamic-service-registry)
11. [External API Proxy](#external-api-proxy)
12. [Kafka Event Bus](#kafka-event-bus)
13. [Health Checks](#health-checks)
14. [SDK — TribeClient](#sdk--tribeclient)
15. [Docker](#docker)
16. [Development](#development)
17. [License](#license)

---

## Overview

**API Center** is a production-grade API gateway that acts as the single front-door for a microservice ecosystem. Instead of hard-coding service routes, services **register themselves** dynamically at boot time. The gateway then:

- **Authenticates** every inbound request via Descope JWT tokens
- **Authorizes** calls using scope-based access control from the registry
- **Proxies** traffic to the correct upstream microservice
- **Logs** every request/response as structured Kafka audit events
- **Protects** upstream services with circuit breakers and rate limiting

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        API CENTER (NestJS)                      │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  AuthModule  │  │RegistryModule│  │  SharedModule (global)  │ │
│  │  - Descope   │  │  - register  │  │  - Logger (Winston)     │ │
│  │  - Guards    │  │  - resolve   │  │  - Exception filter     │ │
│  │  - Token API │  │  - scopes    │  │  - Interceptors         │ │
│  └─────────────┘  └──────────────┘  │  - Middleware            │ │
│                                      └────────────────────────┘ │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ TribesModule │  │ExternalModule│  │  HealthModule           │ │
│  │  - Proxy     │  │  - Circuit   │  │  - /live + /ready       │ │
│  │  - Scope chk │  │    breakers  │  │  - Terminus             │ │
│  │  - Cache     │  │  - 5+ APIs   │  └────────────────────────┘ │
│  └─────────────┘  └──────────────┘                              │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              KafkaModule (KRaft — global)                  │   │
│  │  19 topics  •  structured events  •  audit trail           │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
         ▼              ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ Service A │  │ Service B │  │ Service C │   (registered microservices)
   └──────────┘  └──────────┘  └──────────┘
```

---

## Tech Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| **Framework** | NestJS 10 | Modular, decorator-driven server framework |
| **Language** | TypeScript 5.4 | Type safety with decorators (`emitDecoratorMetadata`) |
| **Auth** | Descope Node SDK | JWT validation, M2M token issuance |
| **Messaging** | KafkaJS + KRaft | Event bus, audit logs (no Zookeeper) |
| **Validation** | class-validator + class-transformer | DTO validation via decorators |
| **Logging** | Winston | Structured JSON logs with levels |
| **HTTP Proxy** | http-proxy-middleware | Reverse proxy to upstream services |
| **External APIs** | Axios + Circuit Breaker | Resilient third-party API calls |
| **Rate Limiting** | @nestjs/throttler | Configurable request throttling |
| **Health Checks** | @nestjs/terminus | Liveness & readiness probes |
| **Security** | Helmet, CORS | HTTP security headers |
| **Testing** | Jest | Unit and e2e testing |
| **Container** | Docker (multi-stage) | Production-hardened images |

---

## Project Structure

```
src/
├── main.ts                          # Bootstrap: NestFactory.create, global pipes/filters
├── app.module.ts                    # Root module — imports all feature modules
│
├── config/
│   ├── config.service.ts            # @Injectable — all env vars in one place
│   └── config.module.ts             # @Global module
│
├── types/
│   └── index.ts                     # Shared interfaces (AuthenticatedRequest, etc.)
│
├── shared/
│   ├── logger.service.ts            # Winston-backed NestJS LoggerService
│   ├── errors.ts                    # Error hierarchy extending HttpException
│   ├── circuit-breaker.ts           # Circuit breaker pattern implementation
│   ├── shared.module.ts             # @Global — exports Logger, filters, interceptors
│   ├── dto/
│   │   ├── token-request.dto.ts     # Token issuance DTO
│   │   ├── refresh-token.dto.ts     # Token refresh DTO
│   │   └── service-manifest.dto.ts  # Service registration DTO
│   ├── filters/
│   │   └── all-exceptions.filter.ts # Global exception filter (catch-all)
│   ├── interceptors/
│   │   ├── correlation-id.interceptor.ts  # UUID tracing per request
│   │   └── audit-log.interceptor.ts       # Kafka audit event after response
│   └── middleware/
│       ├── security.middleware.ts    # Size limit, strip headers, security headers
│       └── morgan.middleware.ts      # HTTP request logging via Morgan
│
├── kafka/
│   ├── topics.ts                    # 19 centralized topic definitions
│   ├── kafka.service.ts             # KafkaJS producer/consumer with lifecycle hooks
│   └── kafka.module.ts              # @Global module
│
├── auth/
│   ├── descope.service.ts           # Descope SDK wrapper (validate, issue, refresh)
│   ├── auth.controller.ts           # POST /auth/token, POST /auth/token/refresh
│   ├── auth.module.ts               # Provides DescopeService + guards
│   └── guards/
│       ├── descope-auth.guard.ts    # CanActivate — JWT validation
│       └── platform-admin.guard.ts  # CanActivate — X-Platform-Secret check
│
├── registry/
│   ├── registry.service.ts          # In-memory service registry + scope engine
│   ├── registry.controller.ts       # CRUD for services (platform-admin only)
│   └── registry.module.ts           # Exports RegistryService
│
├── tribes/
│   ├── tribes.controller.ts         # Dynamic reverse proxy to registered services
│   └── tribes.module.ts             # Imports Auth + Registry
│
├── external/
│   ├── external.service.ts          # API manager with per-API circuit breakers
│   ├── external.controller.ts       # Proxy to external APIs (geolocation, etc.)
│   ├── external.module.ts           # Imports Auth
│   └── apis/
│       ├── index.ts                 # Barrel — exports all API configs
│       ├── geolocation.ts           # IP Geolocation API config
│       ├── geofencing.ts            # Geofencing API config
│       ├── payment.ts               # Payment gateway config
│       ├── sms.ts                   # SMS service config
│       └── email.ts                 # Email service config
│
├── health/
│   ├── health.controller.ts         # /health/live + /health/ready (Terminus)
│   └── health.module.ts             # Imports TerminusModule
│
└── sdk/
    └── TribeClient.ts               # Standalone HTTP client for tribe services
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **Docker** & **Docker Compose** (for Kafka + Redis)
- **Descope** account (for JWT authentication)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in your Descope project ID, management key, and service secrets
```

### 3. Start infrastructure

```bash
docker-compose up -d kafka redis
```

### 4. Run in development

```bash
npm run start:dev
# NestJS watches for file changes and auto-reloads
```

### 5. Build for production

```bash
npm run build
npm run start:prod
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP listen port |
| `NODE_ENV` | No | `development` | `development` / `production` |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origins |
| `DESCOPE_PROJECT_ID` | **Yes** | — | Descope project identifier |
| `DESCOPE_MANAGEMENT_KEY` | **Yes** | — | Descope management API key |
| `KAFKA_BROKERS` | No | `localhost:9092` | Comma-separated Kafka brokers |
| `KAFKA_CLIENT_ID` | No | `api-center` | Kafka client identifier |
| `KAFKA_GROUP_ID` | No | `api-center-group` | Consumer group ID |
| `PLATFORM_ADMIN_SECRET` | **Yes** | — | Secret for registry admin endpoints |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window |
| `TRIBE_SECRET_<SERVICE_ID>` | Per-service | — | SHA-256 hashed secret per service |
| `GEOLOCATION_API_KEY` | No | — | Geolocation external API key |
| `PAYMENT_API_KEY` | No | — | Payment gateway API key |
| `SMS_API_KEY` | No | — | SMS service API key |
| `EMAIL_API_KEY` | No | — | Email service API key |

---

## API Endpoints

All endpoints are prefixed with `/api/v1/`.

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/token` | None | Issue M2M JWT for a service |
| `POST` | `/auth/token/refresh` | None | Refresh an existing JWT |

### Service Registry (Platform Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/registry/register` | `X-Platform-Secret` | Register a service |
| `GET` | `/registry/services` | `X-Platform-Secret` | List all services |
| `GET` | `/registry/services/:id` | `X-Platform-Secret` | Get specific service |
| `DELETE` | `/registry/services/:id` | `X-Platform-Secret` | Remove a service |

### Tribes — Dynamic Service Proxy

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/tribes` | Bearer JWT | List available services |
| `ALL` | `/tribes/:serviceId/*` | Bearer JWT | Proxy to upstream service |

### External APIs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/external` | Bearer JWT | List available external APIs |
| `ALL` | `/external/:apiName/*` | Bearer JWT | Proxy through circuit breaker |

### Health Checks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health/live` | None | Liveness probe |
| `GET` | `/health/ready` | None | Readiness probe (Kafka + registry) |

---

## NestJS Module System

API Center uses NestJS's **modular architecture** where each domain area is encapsulated in its own module. This replaces the Express pattern of flat middleware chains.

### Key NestJS Patterns Used

| Express Pattern | NestJS Equivalent | File |
|----------------|-------------------|------|
| `app.use(middleware)` | `@Module({ ... }) configure(consumer)` | `app.module.ts` |
| `router.get('/path', handler)` | `@Controller('path') @Get()` | Controllers |
| Manual singleton | `@Injectable()` + DI container | Services |
| `req.user` middleware | `@UseGuards(DescopeAuthGuard)` | Guards |
| Error handler `(err, req, res, next)` | `@Catch() ExceptionFilter` | `all-exceptions.filter.ts` |
| Zod schemas | `class-validator` DTOs | `dto/*.dto.ts` |
| `express-rate-limit` | `@nestjs/throttler` ThrottlerGuard | `app.module.ts` |
| Manual bootstrap + shutdown | `OnModuleInit` + `OnModuleDestroy` hooks | Services |
| Correlation ID middleware | `@Injectable() NestInterceptor` | `correlation-id.interceptor.ts` |
| Audit logger middleware | `@Injectable() NestInterceptor` | `audit-log.interceptor.ts` |

### Module Dependency Graph

```
AppModule (root)
├── ConfigModule   (global — env config)
├── SharedModule   (global — logger, filters, interceptors)
├── KafkaModule    (global — event bus)
├── AuthModule     (guards + Descope service)
│   └── imports RegistryModule
├── RegistryModule (service registry CRUD)
├── TribesModule   (dynamic proxy)
│   └── imports AuthModule, RegistryModule
├── ExternalModule (third-party API proxy)
│   └── imports AuthModule
└── HealthModule   (liveness/readiness)
    └── imports RegistryModule, TerminusModule
```

---

## Authentication & Authorization

### Flow

1. **Service Registration** — Platform admin registers a service via `POST /registry/register` with `X-Platform-Secret`
2. **Token Issuance** — Service calls `POST /auth/token` with `{ tribeId, secret }` → gets a scoped JWT
3. **Authenticated Request** — Service includes `Authorization: Bearer <token>` on every call
4. **Guard Validation** — `DescopeAuthGuard` validates the JWT and attaches `req.user` + `req.tribeId`
5. **Scope Check** — Before proxying, the gateway checks if the caller's scopes satisfy the target service's `requiredScopes`

### Guards

- **`DescopeAuthGuard`** — Validates Bearer JWT via Descope SDK. Applied to `/tribes/*` and `/external/*`.
- **`PlatformAdminGuard`** — Validates `X-Platform-Secret` header. Applied to `/registry/*`.

---

## Dynamic Service Registry

Services register themselves at startup by sending a **ServiceManifest**:

```json
{
  "serviceId": "user-service",
  "name": "User Service",
  "baseUrl": "http://user-service:3001",
  "requiredScopes": ["users:read", "users:write"],
  "exposes": ["/users", "/profiles"],
  "consumes": ["notification-service"],
  "healthCheck": "/health",
  "version": "1.2.0"
}
```

The registry then:
- Stores the entry in memory with status `active`
- Publishes a `SERVICE_REGISTERED` Kafka event
- Makes the service available for proxy routing via `/tribes/user-service/*`
- Enforces that only services listed in `consumes` can call this service

---

## External API Proxy

The gateway provides a unified interface to third-party APIs with built-in resilience:

| API | Endpoint | Auth Type |
|-----|----------|-----------|
| Geolocation | `/external/geolocation/*` | API Key |
| Geofencing | `/external/geofencing/*` | Bearer |
| Payment | `/external/payment/*` | Bearer |
| SMS | `/external/sms/*` | Basic |
| Email | `/external/email/*` | Bearer |

Each API has:
- **Circuit Breaker** — Opens after 5 failures, resets after 30s
- **Configurable timeout** — Per-API timeout settings
- **Rate limiting** — Per-API request limits
- **Audit logging** — Every call is published to Kafka

---

## Kafka Event Bus

19 topics covering the full request lifecycle:

| Category | Topics |
|----------|--------|
| Gateway | `gateway.request`, `gateway.response`, `gateway.error` |
| Tribes | `tribe.event`, `tribe.request`, `tribe.response` |
| External | `external.request`, `external.response`, `external.webhook` |
| Auth | `auth.token-issued`, `auth.token-revoked` |
| Audit | `audit.log` |
| Registry | `registry.service-registered`, `registry.service-deregistered` |

All events include `_meta` with `timestamp`, `source`, and `correlationId`.

---

## Health Checks

Built with `@nestjs/terminus`:

- **`GET /api/v1/health/live`** — Returns `200` if the process is alive. Used by Kubernetes liveness probes.
- **`GET /api/v1/health/ready`** — Checks Kafka connectivity and registry state. Used by Kubernetes readiness probes.

Response includes process uptime, memory usage, and service counts.

---

## SDK — TribeClient

A standalone HTTP client for tribe microservices to communicate with the gateway:

```typescript
import { TribeClient } from './sdk/TribeClient';

const client = new TribeClient({
  gatewayUrl: 'http://localhost:3000',
  tribeId: 'my-service',
  secret: process.env.MY_SERVICE_SECRET!,
});

// Authenticate (auto-refreshes)
await client.authenticate();

// Call another registered service
const users = await client.callService('user-service', '/users');

// Call an external API
const location = await client.callExternal('geolocation', '/lookup?ip=8.8.8.8');

// List available services
const services = await client.listServices();
```

---

## Docker

### Development (docker-compose)

```bash
docker-compose up -d
```

Services:
- **api-center** — The NestJS gateway (port 3000)
- **kafka** — KRaft mode (no Zookeeper), port 9092
- **kafka-ui** — Kafka web UI, port 8080
- **redis** — Redis 7 Alpine, port 6379

### Production Build

```dockerfile
# Multi-stage build
FROM node:20-alpine AS builder
# ... install, copy, nest build

FROM node:20-alpine AS runner
# dumb-init for signal handling
# Non-root user (appuser)
CMD ["node", "dist/main.js"]
```

```bash
docker build -t api-center .
docker run -p 3000:3000 --env-file .env api-center
```

---

## Development

```bash
# Watch mode with hot reload
npm run start:dev

# Debug mode
npm run start:debug

# Lint
npm run lint

# Type check without emitting
npm run typecheck

# Run tests
npm test

# Test with coverage
npm run test:cov
```

---

## License

MIT — see [LICENSE](LICENSE) for details.