import { Injectable } from '@nestjs/common';
import { DatabaseCrudService } from '../crud/database-crud.service';
@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseCrudService) {}
  list(query: unknown) {
    return this.database.run((store) => store.list('users', query));
  }
  get(id: string) {
    return this.database.run((store) => store.get('users', id));
  }
  create(body: unknown, actorId: string) {
    return this.database.run((store) => store.create('users', body, actorId));
  }
  update(id: string, body: unknown) {
    return this.database.run((store) => store.update('users', id, body));
  }
  remove(id: string) {
    return this.database.run((store) => store.remove('users', id));
  }
}
