import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ELKLoggerService, LogContext } from '../elk-logger.service';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  constructor(private elkLogger: ELKLoggerService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Add tracing headers to response
    const requestId = req.id || this.generateRequestId();
    const traceId = this.extractTraceId(req);
    const spanId = this.extractSpanId(req);

    res.setHeader('X-Request-ID', requestId);
    if (traceId) {
      res.setHeader('X-Trace-ID', traceId);
    }
    if (spanId) {
      res.setHeader('X-Span-ID', spanId);
    }

    // Store context in request for later use
    req.id = requestId;
    req.traceId = traceId;
    req.spanId = spanId;

    // Log unhandled errors
    res.on('error', (error) => {
      const logContext: LogContext = {
        requestId,
        traceId,
        spanId,
        userId: (req as any).user?.id,
      };

      this.elkLogger.error('Response error', error, logContext, {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
      });
    });

    next();
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractTraceId(req: Request): string | undefined {
    return req.headers['x-trace-id'] as string || 
           req.headers['uber-trace-id'] as string ||
           (req as any).traceId;
  }

  private extractSpanId(req: Request): string | undefined {
    return req.headers['x-span-id'] as string || 
           (req as any).spanId;
  }
}
