import {
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const verifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken })),
}));
import { GoogleTokenService } from './google-token.service';

describe('GoogleTokenService', () => {
  const service = new GoogleTokenService(
    new ConfigService({ GOOGLE_CLIENT_ID: 'client-id' }),
  );

  beforeEach(() => verifyIdToken.mockReset());

  it('rejects login without calling Google when explicitly disabled', async () => {
    const disabled = new GoogleTokenService(
      new ConfigService({ AUTH_GOOGLE_ENABLED: false }),
    );
    await expect(disabled.verify('any-token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('verifies the token against the configured audience', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'sub',
        email: 'user@example.com',
        email_verified: true,
        name: 'User',
      }),
    });
    await expect(service.verify('signed-id-token')).resolves.toEqual({
      sub: 'sub',
      email: 'user@example.com',
      name: 'User',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-id-token',
      audience: 'client-id',
    });
  });

  it.each([
    undefined,
    { sub: 'sub', email: 'user@example.com', email_verified: false },
    { email: 'user@example.com', email_verified: true },
    { sub: 'sub', email_verified: true },
  ])('rejects incomplete or unverified identities', async (payload) => {
    verifyIdToken.mockResolvedValue({ getPayload: () => payload });
    await expect(service.verify('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects verifier errors without exposing the original token', async () => {
    verifyIdToken.mockRejectedValue(new Error('sensitive upstream error'));
    await expect(service.verify('secret')).rejects.toThrow(
      'Token de Google invalido o vencido',
    );
  });
});
