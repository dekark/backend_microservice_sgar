import { Test, TestingModule } from '@nestjs/testing';
import { AreasService } from './areas.service';
import { DatabaseCrudService } from '../crud/database-crud.service';

describe('AreasService', () => {
  let service: AreasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AreasService, { provide: DatabaseCrudService, useValue: {} }],
    }).compile();

    service = module.get<AreasService>(AreasService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
