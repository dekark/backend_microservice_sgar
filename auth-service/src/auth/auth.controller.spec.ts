import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  const loginWithGoogle = jest.fn();
  const refresh = jest.fn();
  const controller = new AuthController({
    loginWithGoogle,
    refresh,
  } as unknown as AuthService);
  const request = {
    ip: '127.0.0.1',
    get: () => 'test-agent',
  } as unknown as Request;
  beforeEach(() => {
    loginWithGoogle.mockReset();
    refresh.mockReset();
  });
  it.each([
    undefined,
    null,
    {},
    [],
    { idToken: 1 },
    { idToken: '' },
    { idToken: '  ' },
    { idToken: 'x'.repeat(16385) },
  ])('rejects invalid Google input %p', (body) => {
    expect(() => controller.login(body, request)).toThrow(BadRequestException);
    expect(loginWithGoogle).not.toHaveBeenCalled();
  });
  it('ignores client-supplied identity and roles', async () => {
    await controller.login(
      { idToken: 'token', roleId: 999, email: 'fake@example.com' },
      request,
    );
    expect(loginWithGoogle).toHaveBeenCalledWith('token', {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
  });
  it.each([{}, { refreshToken: null }, { refreshToken: 'x'.repeat(257) }])(
    'validates refresh input',
    (body) => {
      expect(() => controller.refresh(body, request)).toThrow(
        BadRequestException,
      );
    },
  );
});
