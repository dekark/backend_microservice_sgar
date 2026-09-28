import { Test, TestingModule } from '@nestjs/testing';
import { ResourcesService } from './resources.service';
import { DatabaseCrudService } from '../crud/database-crud.service';

describe('ResourcesService', () => {
  let service: ResourcesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourcesService,
        { provide: DatabaseCrudService, useValue: {} },
      ],
    }).compile();

    service = module.get<ResourcesService>(ResourcesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
