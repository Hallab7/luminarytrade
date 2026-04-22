import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrometheusService, MetricLabels } from '../prometheus.service';
import { Request, Response } from 'express';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private prometheusService: PrometheusService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const startTime = Date.now();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const labels: MetricLabels = {
      method: request.method,
      route: this.getRoute(request),
      service: this.prometheusService['config']?.labels?.service || 'unknown',
    };

    // Track request size
    if (request.headers['content-length']) {
      const requestSize = parseInt(request.headers['content-length']);
      this.prometheusService.observeHttpRequestSize(requestSize, labels);
    }

    return next
      .handle()
      .pipe(
        tap(() => {
          const duration = (Date.now() - startTime) / 1000;
          const responseLabels = {
            ...labels,
            status_code: response.statusCode.toString(),
          };

          // Record metrics
          this.prometheusService.incrementHttpRequests(responseLabels);
          this.prometheusService.observeHttpRequestDuration(duration, responseLabels);

          // Track response size
          if (response.headers['content-length']) {
            const responseSize = parseInt(response.headers['content-length']);
            this.prometheusService.observeHttpResponseSize(responseSize, responseLabels);
          }
        })
      );
  }

  private getRoute(request: Request): string {
    // Try to get the route from the request
    if (request.route) {
      return request.route.path || request.url;
    }
    
    // Fallback to URL pattern matching
    const url = request.url;
    if (url.includes('/jobs/')) {
      return '/jobs/:id';
    }
    if (url.includes('/users/')) {
      return '/users/:id';
    }
    if (url.includes('/loans/')) {
      return '/loans/:id';
    }
    
    return url;
  }
}
