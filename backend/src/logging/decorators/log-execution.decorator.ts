import { Inject } from '@nestjs/common';
import { StructuredLoggerService } from '../structured-logger.service';

export function LogExecution(operationName?: string) {
  const injectLogger = Inject(StructuredLoggerService);

  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const name = operationName || propertyKey;

    descriptor.value = async function(...args: any[]) {
      const logger = (this as any).logger || (this as any).structuredLogger || (this as any).elkLogger;
      
      if (!logger || typeof logger.info !== 'function') {
        return originalMethod.apply(this, args);
      }

      const startTime = Date.now();
      logger.info(`Entering method: ${name}`, { args });

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;
        logger.info(`Exiting method: ${name}`, { duration, success: true });
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`Error in method: ${name}`, error, { duration, success: false });
        throw error;
      }
    };

    return descriptor;
  };
}
