import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';

export const mockExecutionContext = (req: any = {}, res: any = {}): Partial<ExecutionContext> => ({
  switchToHttp: () => ({
    getRequest: () => req,
    getResponse: () => res,
  }),
  getHandler: () => ({ name: 'test-handler' }),
  getClass: () => ({ name: 'test-class' }),
});

export const createMockService = <T>(serviceClass: new (...args: any[]) => T): Record<keyof T, jest.Mock> => {
  const mock: any = {};
  const methods = Object.getOwnPropertyNames(serviceClass.prototype).filter(m => m !== 'constructor');
  for (const method of methods) {
    mock[method] = jest.fn();
  }
  return mock;
};

export const createTestingModule = async (providers: any[], imports: any[] = []) => {
  return await Test.createTestingModule({
    imports,
    providers,
  }).compile();
};

export const injectFailure = (mock: jest.Mock, error: Error = new Error('Test Error')) => {
  mock.mockRejectedValueOnce(error);
};
