import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class CreateOptimizationIndexes1701234567890 implements MigrationInterface {
  name = 'CreateOptimizationIndexes1701234567890';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Users table indexes
    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_USERS_EMAIL_UNIQUE',
        columnNames: ['email'],
        isUnique: true,
      })
    );

    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_USERS_STATUS',
        columnNames: ['status'],
      })
    );

    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_USERS_CREATED_AT',
        columnNames: ['created_at'],
      })
    );

    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_USERS_STATUS_CREATED_AT',
        columnNames: ['status', 'created_at'],
      })
    );

    // Loan applications table indexes
    await queryRunner.createIndex(
      'loan_applications',
      new TableIndex({
        name: 'IDX_LOAN_APPLICATIONS_USER_ID',
        columnNames: ['user_id'],
      })
    );

    await queryRunner.createIndex(
      'loan_applications',
      new TableIndex({
        name: 'IDX_LOAN_APPLICATIONS_STATUS',
        columnNames: ['status'],
      })
    );

    await queryRunner.createIndex(
      'loan_applications',
      new TableIndex({
        name: 'IDX_LOAN_APPLICATIONS_AMOUNT',
        columnNames: ['amount'],
      })
    );

    await queryRunner.createIndex(
      'loan_applications',
      new TableIndex({
        name: 'IDX_LOAN_APPLICATIONS_CREATED_AT',
        columnNames: ['created_at'],
      })
    );

    await queryRunner.createIndex(
      'loan_applications',
      new TableIndex({
        name: 'IDX_LOAN_APPLICATIONS_USER_STATUS',
        columnNames: ['user_id', 'status'],
      })
    );

    await queryRunner.createIndex(
      'loan_applications',
      new TableIndex({
        name: 'IDX_LOAN_APPLICATIONS_STATUS_CREATED_AT',
        columnNames: ['status', 'created_at'],
      })
    );

    // Credit scores table indexes
    await queryRunner.createIndex(
      'credit_scores',
      new TableIndex({
        name: 'IDX_CREDIT_SCORES_USER_ID',
        columnNames: ['user_id'],
      })
    );

    await queryRunner.createIndex(
      'credit_scores',
      new TableIndex({
        name: 'IDX_CREDIT_SCORES_SCORE',
        columnNames: ['score'],
      })
    );

    await queryRunner.createIndex(
      'credit_scores',
      new TableIndex({
        name: 'IDX_CREDIT_SCORES_CREATED_AT',
        columnNames: ['created_at'],
      })
    );

    await queryRunner.createIndex(
      'credit_scores',
      new TableIndex({
        name: 'IDX_CREDIT_SCORES_USER_SCORE',
        columnNames: ['user_id', 'score'],
      })
    );

    // Fraud detections table indexes
    await queryRunner.createIndex(
      'fraud_detections',
      new TableIndex({
        name: 'IDX_FRAUD_DETECTIONS_USER_ID',
        columnNames: ['user_id'],
      })
    );

    await queryRunner.createIndex(
      'fraud_detections',
      new TableIndex({
        name: 'IDX_FRAUD_DETECTIONS_RISK_LEVEL',
        columnNames: ['risk_level'],
      })
    );

    await queryRunner.createIndex(
      'fraud_detections',
      new TableIndex({
        name: 'IDX_FRAUD_DETECTIONS_STATUS',
        columnNames: ['status'],
      })
    );

    await queryRunner.createIndex(
      'fraud_detections',
      new TableIndex({
        name: 'IDX_FRAUD_DETECTIONS_CREATED_AT',
        columnNames: ['created_at'],
      })
    );

    await queryRunner.createIndex(
      'fraud_detections',
      new TableIndex({
        name: 'IDX_FRAUD_DETECTIONS_RISK_STATUS',
        columnNames: ['risk_level', 'status'],
      })
    );

    // Blockchain transactions table indexes
    await queryRunner.createIndex(
      'blockchain_transactions',
      new TableIndex({
        name: 'IDX_BLOCKCHAIN_TRANSACTIONS_USER_ID',
        columnNames: ['user_id'],
      })
    );

    await queryRunner.createIndex(
      'blockchain_transactions',
      new TableIndex({
        name: 'IDX_BLOCKCHAIN_TRANSACTIONS_TX_HASH',
        columnNames: ['tx_hash'],
        isUnique: true,
      })
    );

    await queryRunner.createIndex(
      'blockchain_transactions',
      new TableIndex({
        name: 'IDX_BLOCKCHAIN_TRANSACTIONS_STATUS',
        columnNames: ['status'],
      })
    );

    await queryRunner.createIndex(
      'blockchain_transactions',
      new TableIndex({
        name: 'IDX_BLOCKCHAIN_TRANSACTIONS_NETWORK',
        columnNames: ['network'],
      })
    );

    await queryRunner.createIndex(
      'blockchain_transactions',
      new TableIndex({
        name: 'IDX_BLOCKCHAIN_TRANSACTIONS_CREATED_AT',
        columnNames: ['created_at'],
      })
    );

    await queryRunner.createIndex(
      'blockchain_transactions',
      new TableIndex({
        name: 'IDX_BLOCKCHAIN_TRANSACTIONS_USER_STATUS',
        columnNames: ['user_id', 'status'],
      })
    );

    // Jobs table indexes (for BullMQ)
    await queryRunner.createIndex(
      'jobs',
      new TableIndex({
        name: 'IDX_JOBS_QUEUE_NAME',
        columnNames: ['queue_name'],
      })
    );

    await queryRunner.createIndex(
      'jobs',
      new TableIndex({
        name: 'IDX_JOBS_STATUS',
        columnNames: ['status'],
      })
    );

    await queryRunner.createIndex(
      'jobs',
      new TableIndex({
        name: 'IDX_JOBS_PRIORITY',
        columnNames: ['priority'],
      })
    );

    await queryRunner.createIndex(
      'jobs',
      new TableIndex({
        name: 'IDX_JOBS_CREATED_AT',
        columnNames: ['created_at'],
      })
    );

    await queryRunner.createIndex(
      'jobs',
      new TableIndex({
        name: 'IDX_JOBS_QUEUE_STATUS_PRIORITY',
        columnNames: ['queue_name', 'status', 'priority'],
      })
    );

    // Audit logs table indexes
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_AUDIT_LOGS_USER_ID',
        columnNames: ['user_id'],
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_AUDIT_LOGS_ACTION',
        columnNames: ['action'],
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_AUDIT_LOGS_ENTITY_TYPE',
        columnNames: ['entity_type'],
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_AUDIT_LOGS_CREATED_AT',
        columnNames: ['created_at'],
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_AUDIT_LOGS_ACTION_CREATED_AT',
        columnNames: ['action', 'created_at'],
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_AUDIT_LOGS_USER_ACTION',
        columnNames: ['user_id', 'action'],
      })
    );

    // Materialized views for performance
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS user_loan_stats AS
      SELECT 
        u.id as user_id,
        u.email,
        COUNT(CASE WHEN la.status = 'approved' THEN 1 END) as approved_loans,
        COUNT(CASE WHEN la.status = 'pending' THEN 1 END) as pending_loans,
        COUNT(CASE WHEN la.status = 'rejected' THEN 1 END) as rejected_loans,
        COALESCE(SUM(CASE WHEN la.status = 'approved' THEN la.amount END), 0) as total_approved_amount,
        AVG(CASE WHEN la.status = 'approved' THEN la.amount END) as avg_approved_amount,
        MAX(la.created_at) as last_application_date
      FROM users u
      LEFT JOIN loan_applications la ON u.id = la.user_id
      GROUP BY u.id, u.email
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_USER_LOAN_STATS_USER_ID ON user_loan_stats(user_id)
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS daily_application_metrics AS
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total_applications,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_applications,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_applications,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_applications,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN amount END), 0) as total_approved_amount,
        COALESCE(AVG(CASE WHEN status = 'approved' THEN amount END), 0) as avg_approved_amount
      FROM loan_applications
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_DAILY_APPLICATION_METRICS_DATE ON daily_application_metrics(date)
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS fraud_detection_summary AS
      SELECT 
        DATE(created_at) as date,
        risk_level,
        COUNT(*) as total_detections,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_fraud,
        COUNT(CASE WHEN status = 'false_positive' THEN 1 END) as false_positives,
        COUNT(CASE WHEN status = 'investigating' THEN 1 END) as investigating
      FROM fraud_detections
      GROUP BY DATE(created_at), risk_level
      ORDER BY date DESC, risk_level
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_FRAUD_DETECTION_SUMMARY_DATE ON fraud_detection_summary(date)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_FRAUD_DETECTION_SUMMARY_RISK_DATE ON fraud_detection_summary(risk_level, date)
    `);

    // Create functions for refreshing materialized views
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION refresh_user_loan_stats()
      RETURNS void AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY user_loan_stats;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION refresh_daily_application_metrics()
      RETURNS void AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY daily_application_metrics;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION refresh_fraud_detection_summary()
      RETURNS void AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY fraud_detection_summary;
      END;
      $$ LANGUAGE plpgsql
    `);

    // Create trigger for automatic refresh (optional - can be called manually)
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION trigger_refresh_daily_metrics()
      RETURNS trigger AS $$
      BEGIN
        PERFORM refresh_daily_application_metrics();
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    // Comment: Uncomment to enable automatic refresh (may impact performance)
    // await queryRunner.query(`
    //   CREATE TRIGGER auto_refresh_daily_metrics
    //   AFTER INSERT OR UPDATE ON loan_applications
    //   FOR EACH STATEMENT
    //   EXECUTE FUNCTION trigger_refresh_daily_metrics()
    // `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop materialized views
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS user_loan_stats`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS daily_application_metrics`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS fraud_detection_summary`);

    // Drop functions
    await queryRunner.query(`DROP FUNCTION IF EXISTS refresh_user_loan_stats()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS refresh_daily_application_metrics()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS refresh_fraud_detection_summary()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS trigger_refresh_daily_metrics()`);

    // Drop indexes in reverse order
    // Users table
    await queryRunner.dropIndex('users', 'IDX_USERS_STATUS_CREATED_AT');
    await queryRunner.dropIndex('users', 'IDX_USERS_CREATED_AT');
    await queryRunner.dropIndex('users', 'IDX_USERS_STATUS');
    await queryRunner.dropIndex('users', 'IDX_USERS_EMAIL_UNIQUE');

    // Loan applications table
    await queryRunner.dropIndex('loan_applications', 'IDX_LOAN_APPLICATIONS_STATUS_CREATED_AT');
    await queryRunner.dropIndex('loan_applications', 'IDX_LOAN_APPLICATIONS_USER_STATUS');
    await queryRunner.dropIndex('loan_applications', 'IDX_LOAN_APPLICATIONS_CREATED_AT');
    await queryRunner.dropIndex('loan_applications', 'IDX_LOAN_APPLICATIONS_AMOUNT');
    await queryRunner.dropIndex('loan_applications', 'IDX_LOAN_APPLICATIONS_STATUS');
    await queryRunner.dropIndex('loan_applications', 'IDX_LOAN_APPLICATIONS_USER_ID');

    // Credit scores table
    await queryRunner.dropIndex('credit_scores', 'IDX_CREDIT_SCORES_USER_SCORE');
    await queryRunner.dropIndex('credit_scores', 'IDX_CREDIT_SCORES_CREATED_AT');
    await queryRunner.dropIndex('credit_scores', 'IDX_CREDIT_SCORES_SCORE');
    await queryRunner.dropIndex('credit_scores', 'IDX_CREDIT_SCORES_USER_ID');

    // Fraud detections table
    await queryRunner.dropIndex('fraud_detections', 'IDX_FRAUD_DETECTIONS_RISK_STATUS');
    await queryRunner.dropIndex('fraud_detections', 'IDX_FRAUD_DETECTIONS_CREATED_AT');
    await queryRunner.dropIndex('fraud_detections', 'IDX_FRAUD_DETECTIONS_STATUS');
    await queryRunner.dropIndex('fraud_detections', 'IDX_FRAUD_DETECTIONS_RISK_LEVEL');
    await queryRunner.dropIndex('fraud_detections', 'IDX_FRAUD_DETECTIONS_USER_ID');

    // Blockchain transactions table
    await queryRunner.dropIndex('blockchain_transactions', 'IDX_BLOCKCHAIN_TRANSACTIONS_USER_STATUS');
    await queryRunner.dropIndex('blockchain_transactions', 'IDX_BLOCKCHAIN_TRANSACTIONS_CREATED_AT');
    await queryRunner.dropIndex('blockchain_transactions', 'IDX_BLOCKCHAIN_TRANSACTIONS_NETWORK');
    await queryRunner.dropIndex('blockchain_transactions', 'IDX_BLOCKCHAIN_TRANSACTIONS_STATUS');
    await queryRunner.dropIndex('blockchain_transactions', 'IDX_BLOCKCHAIN_TRANSACTIONS_TX_HASH');
    await queryRunner.dropIndex('blockchain_transactions', 'IDX_BLOCKCHAIN_TRANSACTIONS_USER_ID');

    // Jobs table
    await queryRunner.dropIndex('jobs', 'IDX_JOBS_QUEUE_STATUS_PRIORITY');
    await queryRunner.dropIndex('jobs', 'IDX_JOBS_CREATED_AT');
    await queryRunner.dropIndex('jobs', 'IDX_JOBS_PRIORITY');
    await queryRunner.dropIndex('jobs', 'IDX_JOBS_STATUS');
    await queryRunner.dropIndex('jobs', 'IDX_JOBS_QUEUE_NAME');

    // Audit logs table
    await queryRunner.dropIndex('audit_logs', 'IDX_AUDIT_LOGS_USER_ACTION');
    await queryRunner.dropIndex('audit_logs', 'IDX_AUDIT_LOGS_ACTION_CREATED_AT');
    await queryRunner.dropIndex('audit_logs', 'IDX_AUDIT_LOGS_CREATED_AT');
    await queryRunner.dropIndex('audit_logs', 'IDX_AUDIT_LOGS_ENTITY_TYPE');
    await queryRunner.dropIndex('audit_logs', 'IDX_AUDIT_LOGS_ACTION');
    await queryRunner.dropIndex('audit_logs', 'IDX_AUDIT_LOGS_USER_ID');
  }
}
