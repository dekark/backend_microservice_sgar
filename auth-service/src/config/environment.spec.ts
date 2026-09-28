import { validateEnvironment } from './environment';

describe('environment', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:password@localhost/test',
    GOOGLE_CLIENT_ID: 'client-id',
    JWT_SECRET: 'x'.repeat(32),
  };

  it('sets short-lived tokens and disables registration by default', () => {
    expect(validateEnvironment(valid)).toMatchObject({
      JWT_ACCESS_TTL_SECONDS: 900,
      AUTH_DEFAULT_ROLE_ID: undefined,
    });
  });
  it('allows infrastructure startup with Google explicitly disabled', () => {
    expect(
      validateEnvironment({
        ...valid,
        GOOGLE_CLIENT_ID: '',
        AUTH_GOOGLE_ENABLED: 'false',
      }),
    ).toMatchObject({ AUTH_GOOGLE_ENABLED: false });
  });

  it('rejects ambiguous Google enablement values', () => {
    expect(() =>
      validateEnvironment({ ...valid, AUTH_GOOGLE_ENABLED: 'maybe' }),
    ).toThrow('AUTH_GOOGLE_ENABLED');
  });

  it.each(['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'JWT_SECRET'])(
    'requires %s',
    (key) => {
      expect(() => validateEnvironment({ ...valid, [key]: '' })).toThrow(key);
    },
  );

  it('rejects short secrets', () => {
    expect(() =>
      validateEnvironment({ ...valid, JWT_SECRET: 'short' }),
    ).toThrow('JWT_SECRET');
  });

  it.each(['0', '-1', 'abc', '3601', '1.5'])(
    'rejects invalid access TTL %s',
    (value) => {
      expect(() =>
        validateEnvironment({ ...valid, JWT_ACCESS_TTL_SECONDS: value }),
      ).toThrow('JWT_ACCESS_TTL_SECONDS');
    },
  );
});
