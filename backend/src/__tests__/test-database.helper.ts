import { DataSource } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

@Injectable()
export class TestDatabaseHelper {
  private dataSource: DataSource;

  constructor(private options: TypeOrmModuleOptions) {}

  async initialize() {
    this.dataSource = new DataSource(this.options as any);
    await this.dataSource.initialize();
  }

  async clearDatabase() {
    const entities = this.dataSource.entityMetadatas;
    for (const entity of entities) {
      const repository = this.dataSource.getRepository(entity.name);
      await repository.query(`TRUNCATE TABLE "${entity.tableName}" CASCADE;`);
    }
  }

  async seedDatabase(seeds: any[]) {
    // Implementation for seeding
  }

  async close() {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  getDataSource() {
    return this.dataSource;
  }
}
