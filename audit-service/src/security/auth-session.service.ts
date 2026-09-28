import { randomUUID } from 'node:crypto';
import { BrokerGateway } from '../messaging/broker-client.module';
import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CurrentUser } from './security.types';

function isProfile(value: unknown): value is CurrentUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === 'string' &&
    user.id.length > 0 &&
    typeof user.email === 'string' &&
    user.email.length > 0 &&
    typeof user.name === 'string' &&
    typeof user.roleId === 'number' &&
    Number.isInteger(user.roleId) &&
    user.roleId > 0 &&
    typeof user.role === 'string' &&
    user.role.trim().length > 0 &&
    (user.areaId === null || typeof user.areaId === 'string') &&
    Array.isArray(user.permissions) &&
    user.permissions.every(
      (permission: unknown) =>
        typeof permission === 'string' && permission.trim().length > 0,
    )
  );
}

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly config: ConfigService,
    private readonly broker: BrokerGateway,
  ) {}

  async authenticate(token: string): Promise<CurrentUser> {
    let response: unknown;
    try {
      const transport =
        this.config.get<string>('AUTH_RPC_TRANSPORT') ?? 'rabbit';
      if (transport !== 'rabbit' && transport !== 'kafka')
        throw new Error('Transporte invalido');
      response = await this.broker.send(
        'auth',
        {
          version: 1,
          requestId: randomUUID(),
          expiresAt: new Date(Date.now() + 5000).toISOString(),
          method: 'GET',
          path: '/auth/me',
          accessToken: token,
        },
        transport,
      );
    } catch {
      throw new ServiceUnavailableException('No se pudo verificar la sesion');
    }
    if (
      !response ||
      typeof response !== 'object' ||
      !('statusCode' in response) ||
      typeof response.statusCode !== 'number' ||
      !('ok' in response) ||
      typeof response.ok !== 'boolean' ||
      !('data' in response)
    )
      throw new ServiceUnavailableException(
        'Respuesta de autenticacion invalida',
      );
    if (response.statusCode === 401)
      throw new UnauthorizedException('Sesion invalida o vencida');
    if (response.statusCode === 403)
      throw new ForbiddenException('Usuario o rol no habilitado');
    if (!response.ok || response.statusCode !== 200)
      throw new ServiceUnavailableException('No se pudo verificar la sesion');
    const profile: unknown = response.data;
    if (!isProfile(profile))
      throw new ServiceUnavailableException(
        'Respuesta de autenticacion invalida',
      );
    // Return only the public contract; never trust identity or permissions from the caller.
    const { id, email, name, roleId, role, areaId, permissions } = profile;
    return { id, email, name, roleId, role, areaId, permissions };
  }
}
