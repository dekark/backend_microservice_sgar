import { Injectable } from '@nestjs/common';
import { DatabaseCrudService } from '../crud/database-crud.service';
@Injectable()
export class AuditCrudService {
  constructor(private readonly database: DatabaseCrudService) {}
  list(query: unknown) {
    return this.database.run((store) => store.list('audit', query));
  }
  get(id: string) {
    return this.database.run((store) => store.get('audit', id));
  }
  create(body: unknown, actorId: string) {
    return this.database.run((store) => store.create('audit', body, actorId));
  }
  update(id: string, body: unknown) {
    return this.database.run((store) => store.update('audit', id, body));
  }
  remove(id: string) {
    return this.database.run((store) => store.remove('audit', id));
  }
}
