import { Injectable } from '@nestjs/common';
import { DatabaseCrudService } from '../crud/database-crud.service';
@Injectable()
export class AreasService {
  constructor(private readonly database: DatabaseCrudService) {}
  list(query: unknown) {
    return this.database.run((store) => store.list('areas', query));
  }
  get(id: string) {
    return this.database.run((store) => store.get('areas', id));
  }
  create(body: unknown, actorId: string) {
    return this.database.run((store) => store.create('areas', body, actorId));
  }
  update(id: string, body: unknown) {
    return this.database.run((store) => store.update('areas', id, body));
  }
  remove(id: string) {
    return this.database.run((store) => store.remove('areas', id));
  }
}
