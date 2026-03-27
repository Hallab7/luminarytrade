import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WindowedAnalyticsAggregator } from './aggregators/windowed-analytics.aggregator';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsGateway } from './analytics.gateway';
import { AnalyticsService } from './analytics.service';
import { StreamProcessorService } from './stream-processor.service';

@Module({
  imports: [ConfigModule],
  controllers: [AnalyticsController],
  providers: [WindowedAnalyticsAggregator, AnalyticsService, AnalyticsGateway, StreamProcessorService],
  exports: [AnalyticsService, StreamProcessorService, AnalyticsGateway],
})
export class AnalyticsModule {}
