import { Injectable } from '@nestjs/common';
import { DatabaseCrudService } from '../crud/database-crud.service';
@Injectable()
export class ResourcesService {
  constructor(private readonly database: DatabaseCrudService) {}
  list(query: unknown) {
    return this.database.run((store) => store.list('resources', query));
  }
  get(id: string) {
    return this.database.run((store) => store.get('resources', id));
  }
  create(body: unknown, actorId: string) {
    return this.database.run((store) =>
      store.create('resources', body, actorId),
    );
  }
  update(id: string, body: unknown) {
    return this.database.run((store) => store.update('resources', id, body));
  }
  remove(id: string) {
    return this.database.run((store) => store.remove('resources', id));
  }
}
