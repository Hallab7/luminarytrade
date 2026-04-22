import { Module, Global, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { PrometheusService } from './prometheus.service';
import { MonitoringDecorator } from './decorators/monitored.decorator';
import { MetricsInterceptor } from './interceptors/metrics.interceptor';
import { MetricsMiddleware } from './middleware/metrics.middleware';

@Global()
@Module({
  providers: [PrometheusService, MonitoringDecorator, MetricsInterceptor, MetricsMiddleware],
  exports: [PrometheusService, MonitoringDecorator, MetricsInterceptor, MetricsMiddleware],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(MetricsMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
