import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AnalyticsController } from '../analytics.controller';
import { AnalyticsService } from '../analytics.service';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  const analyticsService = {
    getAgentPerformance: jest.fn(),
    getSystemThroughput: jest.fn(),
    getUserActivity: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        {
          provide: AnalyticsService,
          useValue: analyticsService,
        },
      ],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    jest.clearAllMocks();
  });

  it('returns agent performance', () => {
    analyticsService.getAgentPerformance.mockReturnValue({ agentId: 'a1' });
    const result = controller.getAgentPerformance('a1', '1hour');
    expect(analyticsService.getAgentPerformance).toHaveBeenCalledWith('a1', '1hour');
    expect(result).toEqual({ agentId: 'a1' });
  });

  it('returns throughput with default bucket', () => {
    analyticsService.getSystemThroughput.mockReturnValue({ bucket: '1min' });
    const result = controller.getSystemThroughput(undefined);
    expect(analyticsService.getSystemThroughput).toHaveBeenCalledWith('1min');
    expect(result).toEqual({ bucket: '1min' });
  });

  it('returns user activity', () => {
    analyticsService.getUserActivity.mockReturnValue({ userId: 'u1' });
    const result = controller.getUserActivity('u1', '5min');
    expect(analyticsService.getUserActivity).toHaveBeenCalledWith('u1', '5min');
    expect(result).toEqual({ userId: 'u1' });
  });

  it('throws on invalid window', () => {
    expect(() => controller.getAgentPerformance('a1', '7min')).toThrow(BadRequestException);
  });
});
