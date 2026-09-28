import { Injectable } from '@nestjs/common';
import { DatabaseCrudService } from '../crud/database-crud.service';
@Injectable()
export class PermissionsService {
  constructor(private readonly database: DatabaseCrudService) {}
  list(query: unknown) {
    return this.database.run((store) => store.list('permissions', query));
  }
  get(id: string) {
    return this.database.run((store) => store.get('permissions', id));
  }
  create(body: unknown, actorId: string) {
    return this.database.run((store) =>
      store.create('permissions', body, actorId),
    );
  }
  update(id: string, body: unknown) {
    return this.database.run((store) => store.update('permissions', id, body));
  }
  remove(id: string) {
    return this.database.run((store) => store.remove('permissions', id));
  }
}
