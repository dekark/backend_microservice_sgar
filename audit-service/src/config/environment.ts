import { validateServiceUrls } from '../crud/environment';

export function validateEnvironment(env: Record<string, unknown>) {
  if (typeof env.DATABASE_URL !== 'string' || !env.DATABASE_URL.trim()) {
    throw new Error('DATABASE_URL es obligatorio');
  }
  if (
    !['postgres:', 'postgresql:'].includes(new URL(env.DATABASE_URL).protocol)
  ) {
    throw new Error('DATABASE_URL debe ser PostgreSQL');
  }
  const rabbit = env.RABBITMQ_URL ?? 'amqp://admin:admin123@localhost:5672';
  if (
    typeof rabbit !== 'string' ||
    !['amqp:', 'amqps:'].includes(new URL(rabbit).protocol)
  ) {
    throw new Error('RABBITMQ_URL debe ser AMQP(S)');
  }
  function integer(key: string, fallback: number, max: number) {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new Error(`${key} invalido`);
    return value;
  }
  const queue = env.AUTH_AUDIT_QUEUE ?? 'audit_queue';
  if (typeof queue !== 'string') throw new Error('Nombre de cola invalido');
  const rejected = env.AUDIT_REJECTED_QUEUE ?? `${queue}.invalid`;
  for (const value of [queue, rejected]) {
    if (
      typeof value !== 'string' ||
      !/^[a-zA-Z0-9_.-]{1,200}$/.test(value) ||
      value.startsWith('amq.')
    ) {
      throw new Error('Nombre de cola invalido');
    }
  }
  if (queue === rejected)
    throw new Error('Las colas de entrada y rechazos deben ser diferentes');
  return {
    ...env,
    ...validateServiceUrls(env),
    DATABASE_URL: env.DATABASE_URL,
    RABBITMQ_URL: rabbit,
    AUTH_AUDIT_QUEUE: queue,
    AUDIT_REJECTED_QUEUE: rejected,
    PORT: integer('PORT', 3006, 65535),
    AUDIT_PREFETCH_COUNT: integer('AUDIT_PREFETCH_COUNT', 10, 100),
    AUDIT_RETRY_DELAY_MS: integer('AUDIT_RETRY_DELAY_MS', 1000, 60000),
  };
}
