import { Injectable } from '@nestjs/common';
import { DatabaseCrudService } from '../crud/database-crud.service';
@Injectable()
export class RolesService {
  constructor(private readonly database: DatabaseCrudService) {}
  list(query: unknown) {
    return this.database.run((store) => store.list('roles', query));
  }
  get(id: string) {
    return this.database.run((store) => store.get('roles', id));
  }
  create(body: unknown, actorId: string) {
    return this.database.run((store) => store.create('roles', body, actorId));
  }
  update(id: string, body: unknown) {
    return this.database.run((store) => store.update('roles', id, body));
  }
  remove(id: string) {
    return this.database.run((store) => store.remove('roles', id));
  }
  permissions(id: string) {
    return this.database.run((store) => store.rolePermissions(id));
  }
  setPermissions(id: string, body: unknown) {
    return this.database.run((store) => store.setRolePermissions(id, body));
  }
}
