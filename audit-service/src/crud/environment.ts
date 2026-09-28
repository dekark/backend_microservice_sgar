export function validateServiceUrls(env: Record<string, unknown>) {
  const origin = env.AUTH_SERVICE_URL ?? 'http://localhost:3000';
  if (typeof origin !== 'string')
    throw new Error('AUTH_SERVICE_URL debe ser un string');
  const auth = new URL(origin);
  if (
    !['http:', 'https:'].includes(auth.protocol) ||
    auth.username ||
    auth.password ||
    auth.search ||
    auth.hash ||
    auth.pathname !== '/'
  ) {
    throw new Error(
      'AUTH_SERVICE_URL debe ser un origen HTTP(S) sin credenciales ni ruta',
    );
  }
  if (env.DATABASE_URL !== undefined) {
    if (
      typeof env.DATABASE_URL !== 'string' ||
      !['postgres:', 'postgresql:'].includes(new URL(env.DATABASE_URL).protocol)
    ) {
      throw new Error('DATABASE_URL debe ser una URL PostgreSQL');
    }
  }
  return { AUTH_SERVICE_URL: auth.origin };
}
