import {
  Injectable,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

import {
  createDatabase,
  Database,
} from './database';

@Injectable()
export class DatabaseService {

  readonly db: Database;

  constructor(
    config: ConfigService,
  ) {
    this.db = createDatabase(
      config.getOrThrow<string>(
        'DATABASE_URL',
      ),
    );
  }
}