import { Module, Global } from '@nestjs/common';
import { ELKLoggerService } from './elk-logger.service';
import { StructuredLoggerService } from './structured-logger.service';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { LoggingMiddleware } from './middleware/logging.middleware';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';

@Global()
@Module({
  providers: [
    ELKLoggerService, 
    StructuredLoggerService,
    LoggingInterceptor, 
    LoggingMiddleware,
    CorrelationIdMiddleware,
  ],
  exports: [
    ELKLoggerService, 
    StructuredLoggerService,
    LoggingInterceptor, 
    LoggingMiddleware,
    CorrelationIdMiddleware,
  ],
})
export class LoggingModule {}
