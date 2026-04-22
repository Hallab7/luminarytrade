import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AppConfigService } from './app-config.service';

export class DatabaseConfigFactory {
  createConfig(config: AppConfigService): TypeOrmModuleOptions {
    const dbConfig = config.database;
    const isProduction = config.nodeEnv === 'production';

    return {
      type: 'postgres',
      host: dbConfig.host,
      port: dbConfig.port,
      username: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.name,
      
      // Connection Pool Configuration
      extra: {
        // Connection pool settings
        min: dbConfig.minConnections,
        max: dbConfig.maxConnections,
        idleTimeoutMillis: dbConfig.idleTimeoutMillis,
        connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
        acquireTimeoutMillis: dbConfig.acquireTimeoutMillis,
        createTimeoutMillis: dbConfig.createTimeoutMillis,
        destroyTimeoutMillis: dbConfig.destroyTimeoutMillis,
        reapIntervalMillis: dbConfig.reapIntervalMillis,
        createRetryIntervalMillis: dbConfig.createRetryIntervalMillis,
        
        // SSL Configuration
        ssl: dbConfig.enableSsl ? {
          rejectUnauthorized: true,
          sslmode: dbConfig.sslMode,
          cert: dbConfig.sslCert,
          key: dbConfig.sslKey,
          ca: dbConfig.sslCA,
        } : false,
        
        // Query Optimization
        statement_timeout: dbConfig.enableStatementTimeout ? dbConfig.statementTimeout : undefined,
        query_timeout: dbConfig.enableStatementTimeout ? dbConfig.statementTimeout : undefined,
        application_name: 'luminarytrade-backend',
        
        // Performance settings
        maxPreparedStatements: 10,
        preparedStatementCacheSize: 100,
        
        // Connection validation
        validateConnection: true,
        validationQuery: dbConfig.validationQuery,
        
        // Logging and monitoring
        logging: dbConfig.enableQueryLogging ? ['query', 'error', 'warn'] : ['error'],
        logger: 'advanced-console',
        logNotifications: isProduction,
        logSlowQueries: true,
        maxQueryExecutionTime: dbConfig.slowQueryThreshold / 1000, // Convert to seconds
      },
      
      // TypeORM settings
      autoLoadEntities: true,
      synchronize: config.nodeEnv !== 'production',
      
      // Performance optimizations
      retryAttempts: 3,
      retryDelay: 3000,
      cache: dbConfig.enableQueryCache ? {
        type: 'redis',
        options: {
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
          ttl: dbConfig.queryCacheTimeout / 1000, // Convert to seconds
          max: 100,
        },
      } : false,
      
      // Query optimization
      migrationsRun: true,
      migrationsTransactionMode: 'each',
      
      // Development vs Production settings
      debug: !isProduction && dbConfig.enableQueryLogging,
      timezone: 'UTC',
      charset: 'utf8',
      
      // Connection pool monitoring
      poolErrorRecovery: {
        retries: 3,
        retryDelay: 2000,
        backoffMultiplier: 1.5,
      },
    };
  }
}