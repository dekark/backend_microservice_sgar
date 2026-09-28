import { Injectable } from '@nestjs/common';
import { DatabaseCrudService } from '../crud/database-crud.service';

@Injectable()
export class AreaUsersService {
  constructor(private readonly database: DatabaseCrudService) {}
  list(actorId: string, area: string, query: unknown) {
    return this.database.runArea((store) =>
      store.list('users', actorId, area, query),
    );
  }
  get(actorId: string, area: string, id: string) {
    return this.database.runArea((store) =>
      store.get('users', actorId, area, id),
    );
  }
  create(actorId: string, area: string, body: unknown) {
    return this.database.runArea((store) =>
      store.create('users', actorId, area, body),
    );
  }
  update(actorId: string, area: string, id: string, body: unknown) {
    return this.database.runArea((store) =>
      store.update('users', actorId, area, id, body),
    );
  }
  remove(actorId: string, area: string, id: string) {
    return this.database.runArea((store) =>
      store.remove('users', actorId, area, id),
    );
  }
}
