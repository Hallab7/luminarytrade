import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WindowedAnalyticsAggregator } from './aggregators/windowed-analytics.aggregator';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsGateway } from './analytics.gateway';
import { AnalyticsResolver } from './analytics.resolver';
import { AnalyticsService } from './analytics.service';
import { ComputeBridgeService } from '../compute-bridge/compute-bridge.service';
import { StreamProcessorService } from './stream-processor.service';

@Module({
  imports: [ConfigModule],
  controllers: [AnalyticsController],
  providers: [
    WindowedAnalyticsAggregator,
    AnalyticsService,
    AnalyticsGateway,
    StreamProcessorService,
    AnalyticsResolver,
    ComputeBridgeService,   // new — provides all risk/optimization math
  ],
  exports: [AnalyticsService, StreamProcessorService, AnalyticsGateway],
})
export class AnalyticsModule {}