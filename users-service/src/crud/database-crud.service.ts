import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createTransactionalDatabase,
  CrudStore,
  ImageStore,
  AreaCrudStore,
  crudErrorStatus,
} from 'database';
@Injectable()
export class DatabaseCrudService implements OnModuleDestroy {
  private connection?: ReturnType<typeof createTransactionalDatabase>;
  private store?: CrudStore;
  private readonly logger = new Logger(DatabaseCrudService.name);
  constructor(private readonly config: ConfigService) {}
  async run<T>(operation: (store: CrudStore) => Promise<T>): Promise<T> {
    try {
      if (!this.store) {
        this.connection = createTransactionalDatabase(
          this.config.getOrThrow<string>('DATABASE_URL'),
        );
        this.connection.pool.on('error', () =>
          this.logger.error('Database connection error'),
        );
        this.store = new CrudStore(this.connection.pool);
      }
      return await operation(this.store);
    } catch (error) {
      const known = crudErrorStatus(error);
      if (known) throw new HttpException(known.message, known.status);
      this.logger.error('Database operation unavailable');
      throw new ServiceUnavailableException(
        'Base de datos no disponible; verifica DATABASE_URL y las migraciones',
      );
    }
  }
  runArea<T>(operation: (store: AreaCrudStore) => Promise<T>): Promise<T> {
    return this.run(() => {
      if (!this.connection) throw new Error('Database connection unavailable');
      return operation(new AreaCrudStore(this.connection.pool));
    });
  }
  runImages<T>(operation: (store: ImageStore) => Promise<T>): Promise<T> {
    return this.run(() => {
      if (!this.connection) throw new Error('Database connection unavailable');
      return operation(new ImageStore(this.connection.pool));
    });
  }
  async onModuleDestroy() {
    await this.connection?.pool.end();
  }
}
