import { Injectable } from '@nestjs/common';
import { DatabaseCrudService } from '../crud/database-crud.service';

@Injectable()
export class AreaResourcesService {
  constructor(private readonly database: DatabaseCrudService) {}
  list(actorId: string, area: string, query: unknown) {
    return this.database.runArea((store) =>
      store.list('resources', actorId, area, query),
    );
  }
  get(actorId: string, area: string, id: string) {
    return this.database.runArea((store) =>
      store.get('resources', actorId, area, id),
    );
  }
  create(actorId: string, area: string, body: unknown) {
    return this.database.runArea((store) =>
      store.create('resources', actorId, area, body),
    );
  }
  update(actorId: string, area: string, id: string, body: unknown) {
    return this.database.runArea((store) =>
      store.update('resources', actorId, area, id, body),
    );
  }
  remove(actorId: string, area: string, id: string) {
    return this.database.runArea((store) =>
      store.remove('resources', actorId, area, id),
    );
  }
}
