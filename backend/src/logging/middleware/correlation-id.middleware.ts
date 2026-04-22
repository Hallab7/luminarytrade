import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { traceContextStorage } from '../../common/async-storage';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
    const userId = (req as any).user?.id || (req.headers['x-user-id'] as string);

    // Set header for response propagation
    res.setHeader('x-correlation-id', correlationId);

    // Run within the context of correlation ID storage
    traceContextStorage.run({ correlationId, userId }, () => {
      next();
    });
  }
}
