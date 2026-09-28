import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseCrudService } from './database-crud.service';
@Module({
  imports: [ConfigModule],
  providers: [DatabaseCrudService],
  exports: [DatabaseCrudService],
})
export class CrudModule {}
