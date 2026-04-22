import { Module, Global } from '@nestjs/common';
import { TracingService } from './tracing.service';
import { JaegerConfigService } from './jaeger.config';
import { TracingInterceptor } from './interceptors/tracing.interceptor';
import { TracingMiddleware } from './middleware/tracing.middleware';

@Global()
@Module({
  providers: [TracingService, JaegerConfigService, TracingInterceptor, TracingMiddleware],
  exports: [TracingService, JaegerConfigService, TracingInterceptor, TracingMiddleware],
})
export class TracingModule {}
