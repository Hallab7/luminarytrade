import { StreamProcessorService } from '../stream-processor.service';
import { AnalyticsService } from '../analytics.service';
import { AnalyticsGateway } from '../analytics.gateway';

describe('StreamProcessorService', () => {
  const configService = {
    get: jest.fn(),
  };

  const analyticsService = {
    ingest: jest.fn(),
    getSystemThroughput: jest.fn().mockReturnValue({ requestsPerMinute: 10, errorsPerMinute: 1 }),
    getBlockchainStats: jest.fn().mockReturnValue({ successRate: 1 }),
    prune: jest.fn(),
  } as unknown as AnalyticsService;

  const gateway = {
    broadcastUpdate: jest.fn(),
  } as unknown as AnalyticsGateway;

  let service: StreamProcessorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StreamProcessorService(configService as any, analyticsService, gateway);
  });

  it('accepts only relevant events', () => {
    const accepted = (service as any).isRelevantEvent({ type: 'user.request' });
    const rejected = (service as any).isRelevantEvent({ type: 'unknown' });
    expect(accepted).toBe(true);
    expect(rejected).toBe(false);
  });

  it('transforms valid event payload and defaults timestamp when missing', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(12345);
    const parsed = (service as any).transformEvent('{"type":"user.request","payload":{}}');
    expect(parsed).toEqual({ type: 'user.request', payload: {}, ts: 12345 });
    nowSpy.mockRestore();
  });

  it('returns null for invalid payload', () => {
    const parsed = (service as any).transformEvent('{invalid');
    expect(parsed).toBeNull();
  });

  it('broadcasts analytics snapshots', () => {
    (service as any).publishSnapshot();
    expect((analyticsService as any).getSystemThroughput).toHaveBeenCalledWith('1min');
    expect((analyticsService as any).getBlockchainStats).toHaveBeenCalledWith('1hour');
    expect((gateway as any).broadcastUpdate).toHaveBeenCalled();
  });
});
