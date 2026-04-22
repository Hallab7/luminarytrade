import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrometheusService } from '../prometheus.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private prometheusService: PrometheusService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Track active connections
    this.prometheusService.setActiveConnections(1, {
      type: 'http',
      service: this.prometheusService['config']?.labels?.service || 'unknown',
    });

    // Setup cleanup on response finish
    res.on('finish', () => {
      // Decrement active connections
      this.prometheusService.setActiveConnections(-1, {
        type: 'http',
        service: this.prometheusService['config']?.labels?.service || 'unknown',
      });
    });

    next();
  }
}
