import { AREA_USER_ROLE } from 'database';
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { DatabaseCrudService } from '../crud/database-crud.service';
import type { AuthenticatedRequest } from './security.types';

@Injectable()
export class AreaUserGuard implements CanActivate {
  constructor(private readonly database: DatabaseCrudService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user)
      throw new UnauthorizedException('Primero debes autenticar la sesion');
    if (request.user.role !== AREA_USER_ROLE)
      throw new ForbiddenException('Se requiere el rol usuario normal');
    const area = request.params.area;
    if (typeof area !== 'string')
      throw new ForbiddenException('Se requiere un area');
    await this.database.runUserResources((store) =>
      store.authorize(request.user.id, area),
    );
    return true;
  }
}
