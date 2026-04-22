import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ELKLoggerService, LogContext } from '../elk-logger.service';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private elkLogger: ELKLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const startTime = Date.now();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Generate request ID if not present
    const requestId = request.id || this.generateRequestId();
    request.id = requestId;

    // Extract tracing context
    const traceId = this.extractTraceId(request);
    const spanId = this.extractSpanId(request);

    const logContext: LogContext = {
      requestId,
      traceId,
      spanId,
      userId: request.user?.id,
      sessionId: request.session?.id,
    };

    // Log request start
    this.elkLogger.info('Request started', logContext, {
      method: request.method,
      url: request.url,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
      contentType: request.headers['content-type'],
    });

    return next
      .handle()
      .pipe(
        tap(() => {
          const duration = Date.now() - startTime;
          
          // Log request completion
          this.elkLogger.logHttpRequest(request, response, duration);
        })
      );
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractTraceId(request: Request): string | undefined {
    return request.headers['x-trace-id'] as string || 
           request.headers['uber-trace-id'] as string ||
           request.traceId;
  }

  private extractSpanId(request: Request): string | undefined {
    return request.headers['x-span-id'] as string || 
           request.spanId;
  }
}
