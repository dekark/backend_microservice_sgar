export function validateEnvironment(env: Record<string, unknown>) {
  const googleEnabled = env.AUTH_GOOGLE_ENABLED ?? 'true';
  if (
    !['true', 'false', true, false].includes(googleEnabled as string | boolean)
  ) {
    throw new Error('AUTH_GOOGLE_ENABLED debe ser true o false');
  }
  const enableGoogle = googleEnabled === 'true' || googleEnabled === true;
  for (const key of [
    'DATABASE_URL',
    'JWT_SECRET',
    ...(enableGoogle ? ['GOOGLE_CLIENT_ID'] : []),
  ]) {
    if (typeof env[key] !== 'string' || !env[key].trim()) {
      throw new Error(`${key} es obligatorio`);
    }
  }
  if (Buffer.byteLength(env.JWT_SECRET as string) < 32) {
    throw new Error('JWT_SECRET debe contener al menos 32 bytes');
  }
  const databaseUrl = new URL(env.DATABASE_URL as string);
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('DATABASE_URL debe ser una URL PostgreSQL');
  }
  const numberValue = (key: string, fallback: number, max: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) {
      throw new Error(`${key} debe ser un entero entre 1 y ${max}`);
    }
    return value;
  };
  const defaultRole = env.AUTH_DEFAULT_ROLE_ID;
  const enabled = env.AUTH_BACKGROUND_JOBS_ENABLED ?? 'true';
  if (!['true', 'false', true, false].includes(enabled as string | boolean)) {
    throw new Error('AUTH_BACKGROUND_JOBS_ENABLED debe ser true o false');
  }
  const frontend = new URL(
    (env.FRONTEND_ORIGIN || 'http://localhost:4200') as string,
  );
  if (
    !['http:', 'https:'].includes(frontend.protocol) ||
    frontend.origin !== (env.FRONTEND_ORIGIN || 'http://localhost:4200')
  ) {
    throw new Error('FRONTEND_ORIGIN debe ser un origen HTTP(S) sin ruta');
  }
  return {
    ...env,
    AUTH_GOOGLE_ENABLED: enableGoogle,
    PORT: numberValue('PORT', 3000, 65535),
    JWT_ACCESS_TTL_SECONDS: numberValue('JWT_ACCESS_TTL_SECONDS', 900, 3600),
    REFRESH_TOKEN_TTL_SECONDS: numberValue(
      'REFRESH_TOKEN_TTL_SECONDS',
      2592000,
      7776000,
    ),
    AUTH_BACKGROUND_JOBS_ENABLED: enabled === 'true' || enabled === true,
    AUTH_OUTBOX_INTERVAL_MS: numberValue(
      'AUTH_OUTBOX_INTERVAL_MS',
      5000,
      60000,
    ),
    AUTH_RETENTION_DAYS: numberValue('AUTH_RETENTION_DAYS', 30, 365),
    AUTH_KAFKA_TOPIC: env.AUTH_KAFKA_TOPIC || 'auth.events.v1',
    AUTH_AUDIT_QUEUE: env.AUTH_AUDIT_QUEUE || 'audit_queue',
    AUTH_DEFAULT_ROLE_ID:
      defaultRole === undefined || defaultRole === ''
        ? undefined
        : numberValue('AUTH_DEFAULT_ROLE_ID', 1, 2147483647),
    JWT_ISSUER: env.JWT_ISSUER || 'auth-service',
    JWT_AUDIENCE: env.JWT_AUDIENCE || 'backend-api',
    FRONTEND_ORIGIN: env.FRONTEND_ORIGIN || 'http://localhost:4200',
  };
}
