import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

/**
 * Issue #237 — Optimize Database Query Performance
 * Adds indexes for high-frequency queries in trading and analytics modules.
 */
export class AddTradingAnalyticsIndexes1745358313000 implements MigrationInterface {
  name = 'AddTradingAnalyticsIndexes1745358313000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // oracle_snapshots — pair + timestamp is the hottest query path
    await queryRunner.createIndex(
      'oracle_snapshots',
      new TableIndex({
        name: 'IDX_ORACLE_SNAPSHOTS_PAIR_TIMESTAMP',
        columnNames: ['pair', 'timestamp'],
      }),
    );

    await queryRunner.createIndex(
      'oracle_snapshots',
      new TableIndex({
        name: 'IDX_ORACLE_SNAPSHOTS_TIMESTAMP',
        columnNames: ['timestamp'],
      }),
    );

    // submissions — status + created_at for queue polling
    await queryRunner.createIndex(
      'submissions',
      new TableIndex({
        name: 'IDX_SUBMISSIONS_STATUS_CREATED_AT',
        columnNames: ['status', 'created_at'],
      }),
    );

    await queryRunner.createIndex(
      'submissions',
      new TableIndex({
        name: 'IDX_SUBMISSIONS_IDEMPOTENCY_KEY',
        columnNames: ['idempotency_key'],
        isUnique: true,
      }),
    );

    // audit_logs — wallet + event_type + timestamp for analytics dashboards
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_AUDIT_LOGS_WALLET_EVENT_TIMESTAMP',
        columnNames: ['wallet', 'event_type', 'timestamp'],
      }),
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_AUDIT_LOGS_TIMESTAMP',
        columnNames: ['timestamp'],
      }),
    );

    // agents — is_active + evolution_level for search/filter queries
    await queryRunner.createIndex(
      'agents',
      new TableIndex({
        name: 'IDX_AGENTS_ACTIVE_EVOLUTION',
        columnNames: ['is_active', 'evolution_level'],
      }),
    );

    await queryRunner.createIndex(
      'agents',
      new TableIndex({
        name: 'IDX_AGENTS_CREATED_AT',
        columnNames: ['created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('oracle_snapshots', 'IDX_ORACLE_SNAPSHOTS_PAIR_TIMESTAMP');
    await queryRunner.dropIndex('oracle_snapshots', 'IDX_ORACLE_SNAPSHOTS_TIMESTAMP');
    await queryRunner.dropIndex('submissions', 'IDX_SUBMISSIONS_STATUS_CREATED_AT');
    await queryRunner.dropIndex('submissions', 'IDX_SUBMISSIONS_IDEMPOTENCY_KEY');
    await queryRunner.dropIndex('audit_logs', 'IDX_AUDIT_LOGS_WALLET_EVENT_TIMESTAMP');
    await queryRunner.dropIndex('audit_logs', 'IDX_AUDIT_LOGS_TIMESTAMP');
    await queryRunner.dropIndex('agents', 'IDX_AGENTS_ACTIVE_EVOLUTION');
    await queryRunner.dropIndex('agents', 'IDX_AGENTS_CREATED_AT');
  }
}
