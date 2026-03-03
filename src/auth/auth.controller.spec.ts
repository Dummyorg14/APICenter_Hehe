// =============================================================================
// Unit tests — AuthController
// =============================================================================
// Verifies token issuance and refresh endpoints, including the fix
// that both responses now include `refreshToken`.
// =============================================================================

import { AuthController } from './auth.controller';
import { DescopeService } from './descope.service';
import { RegistryService } from '../registry/registry.service';
import { LoggerService } from '../shared/logger.service';
import { NotFoundError, UnauthorizedError } from '../shared/errors';
import { AuthenticatedRequest } from '../types';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockDescope: Partial<DescopeService> = {
  issueToken: jest.fn(),
  refreshToken: jest.fn(),
};

const mockRegistry: Partial<RegistryService> = {
  get: jest.fn(),
  validateSecret: jest.fn(),
};

const mockLogger: Partial<LoggerService> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function fakeReq(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return { correlationId: 'corr-1' } as AuthenticatedRequest;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(
      mockDescope as DescopeService,
      mockRegistry as RegistryService,
      mockLogger as LoggerService,
    );
  });

  // =========================================================================
  // POST /auth/token
  // =========================================================================

  describe('issueToken()', () => {
    const dto = { tribeId: 'svc-alpha', secret: 's3cret' };

    it('returns accessToken AND refreshToken', async () => {
      (mockRegistry.get as jest.Mock).mockReturnValue({
        serviceId: 'svc-alpha',
        requiredScopes: ['read'],
        consumes: [],
      });
      (mockRegistry.validateSecret as jest.Mock).mockResolvedValue(true);
      (mockDescope.issueToken as jest.Mock).mockResolvedValue({
        sessionJwt: 'access-jwt',
        refreshJwt: 'refresh-jwt',
        expiresIn: 3600,
      });

      const result = await controller.issueToken(dto, fakeReq());

      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBe('access-jwt');
      expect(result.data.refreshToken).toBe('refresh-jwt');
      expect(result.data.expiresIn).toBe(3600);
    });

    it('returns refreshToken as null when Descope omits it', async () => {
      (mockRegistry.get as jest.Mock).mockReturnValue({
        serviceId: 'svc-alpha',
        requiredScopes: [],
        consumes: [],
      });
      (mockRegistry.validateSecret as jest.Mock).mockResolvedValue(true);
      (mockDescope.issueToken as jest.Mock).mockResolvedValue({
        sessionJwt: 'access-jwt',
        expiresIn: 3600,
        // no refreshJwt
      });

      const result = await controller.issueToken(dto, fakeReq());
      expect(result.data.refreshToken).toBeNull();
    });

    it('throws NotFoundError for unknown tribe', async () => {
      (mockRegistry.get as jest.Mock).mockReturnValue(null);

      await expect(controller.issueToken(dto, fakeReq())).rejects.toThrow(NotFoundError);
    });

    it('throws UnauthorizedError for invalid secret', async () => {
      (mockRegistry.get as jest.Mock).mockReturnValue({ serviceId: 'svc-alpha' });
      (mockRegistry.validateSecret as jest.Mock).mockResolvedValue(false);

      await expect(controller.issueToken(dto, fakeReq())).rejects.toThrow(UnauthorizedError);
    });
  });

  // =========================================================================
  // POST /auth/token/refresh
  // =========================================================================

  describe('refreshToken()', () => {
    it('returns accessToken AND refreshToken', async () => {
      (mockDescope.refreshToken as jest.Mock).mockResolvedValue({
        data: {
          sessionJwt: 'new-access',
          refreshJwt: 'new-refresh',
          expiresIn: 3600,
        },
      });

      const result = await controller.refreshToken(
        { refreshToken: 'old-refresh' },
        fakeReq(),
      );

      expect(result.data.accessToken).toBe('new-access');
      expect(result.data.refreshToken).toBe('new-refresh');
    });

    it('returns refreshToken as null when Descope omits it', async () => {
      (mockDescope.refreshToken as jest.Mock).mockResolvedValue({
        data: {
          sessionJwt: 'new-access',
          expiresIn: 3600,
        },
      });

      const result = await controller.refreshToken(
        { refreshToken: 'old-refresh' },
        fakeReq(),
      );

      expect(result.data.refreshToken).toBeNull();
    });
  });
});
