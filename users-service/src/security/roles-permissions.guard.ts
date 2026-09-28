import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS, REQUIRED_ROLES } from './access.decorators';
import type { AuthenticatedRequest } from './security.types';

@Injectable()
export class RolesPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user)
      throw new UnauthorizedException('Primero debes autenticar la sesion');

    // Method restrictions add to controller restrictions; neither can weaken the other.
    for (const target of [context.getClass(), context.getHandler()]) {
      const roles = this.reflector.get<string[]>(REQUIRED_ROLES, target);
      const permissions = this.reflector.get<string[]>(
        REQUIRED_PERMISSIONS,
        target,
      );
      if (roles && !roles.includes(user.role)) {
        throw new ForbiddenException('Tu rol no tiene acceso a esta ruta');
      }
      if (
        permissions &&
        !permissions.every((key) => user.permissions.includes(key))
      ) {
        throw new ForbiddenException('No tienes los permisos requeridos');
      }
    }
    return true;
  }
}
