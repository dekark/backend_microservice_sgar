import { validateServiceUrls } from '../crud/environment';
export function validateEnvironment(env: Record<string, unknown>) {
  const port = Number(env.PORT ?? 3005);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535');
  }
  return { ...env, PORT: port, ...validateServiceUrls(env) };
}
