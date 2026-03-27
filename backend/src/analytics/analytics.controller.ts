import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsWindow } from './types';

const SUPPORTED_WINDOWS: AnalyticsWindow[] = ['1min', '5min', '1hour', '1day'];

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  private parseWindow(value?: string): AnalyticsWindow {
    const parsed = (value ?? '1hour') as AnalyticsWindow;
    if (!SUPPORTED_WINDOWS.includes(parsed)) {
      throw new BadRequestException(
        `Invalid window '${value}'. Supported: ${SUPPORTED_WINDOWS.join(', ')}`,
      );
    }
    return parsed;
  }

  @Get('agents/:id/performance')
  getAgentPerformance(@Param('id') id: string, @Query('window') window?: string) {
    return this.analytics.getAgentPerformance(id, this.parseWindow(window));
  }

  @Get('system/throughput')
  getSystemThroughput(@Query('bucket') bucket?: string) {
    return this.analytics.getSystemThroughput(this.parseWindow(bucket ?? '1min'));
  }

  @Get('users/:id/activity')
  getUserActivity(@Param('id') id: string, @Query('window') window?: string) {
    return this.analytics.getUserActivity(id, this.parseWindow(window));
  }
}
