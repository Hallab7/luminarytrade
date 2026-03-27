import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { SimulatorModule } from './simulator/simulator.module';
import { SubmitterModule } from './submitter/submitter.module';
import { ComputeBridgeModule } from './compute-bridge/compute-bridge.module';
import { IndexerModule } from './agent/agent.module';
import { AuditLogModule } from './audit/audit-log.module';
import { WorkerModule } from './worker/worker.module';
import { OracleModule } from './oracle/oracle.module';
import { TransactionModule } from './transaction/transaction.module';
import { RateLimitingModule } from './rate-limiting/rate-limiting.module';
import { TracingModule } from './tracing/tracing.module';
import { AuthModule } from './auth/auth.module';
import { StartupModule } from './startup/startup.module';
import { MaterializedViewsModule } from './materialized-view/materialized-view.module';
import { DatabaseConfigFactory } from './config/database.factory';
import { CacheConfigFactory } from './config/cache.factory';
import { PluginsModule } from './plugins/plugins.module';
import { validate } from './config/config.validation';
import { AppConfigService } from './config/app-config.service';
import { MiddlewarePipelineModule } from './middleware-pipeline/middleware-pipeline.module';
import { DecoratorCompositionModule } from './decorator-composition/decorator-composition.module';
import { HealthModule } from './health/health.module';
import { EventsModule } from './events/events.module';
import { GraphqlApiModule } from './graphql/graphql.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    StartupModule,
    HealthModule,
    EventsModule,
    PluginsModule,
    TypeOrmModule.forRootAsync({
      useFactory: (appConfig: AppConfigService) => {
        const factory = new DatabaseConfigFactory();
        return factory.createConfig(appConfig);
      },
      inject: [AppConfigService],
    }),
    BullModule.forRootAsync({
      useFactory: () => {
        const factory = new CacheConfigFactory();
        return factory.createConfig();
      },
    }),
    TracingModule,
    TransactionModule,
    SimulatorModule,
    SubmitterModule,
    ComputeBridgeModule,
    IndexerModule,
    AuditLogModule,
    WorkerModule,
    OracleModule,
    RateLimitingModule,
    AuthModule,
    MaterializedViewsModule,
    MiddlewarePipelineModule,
    DecoratorCompositionModule,
    GraphqlApiModule,
    AnalyticsModule,
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
  controllers: [AppController],
})
export class AppModule {}
