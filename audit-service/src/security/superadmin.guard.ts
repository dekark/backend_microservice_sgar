import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './security.types';

@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // AuthSessionGuard must run first and obtain the current role from auth-service.
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      throw new UnauthorizedException('Primero debes autenticar la sesion');
    }
    if (user.role !== 'superadministrador') {
      throw new ForbiddenException('Se requiere el rol superadministrador');
    }
    return true;
  }
}
