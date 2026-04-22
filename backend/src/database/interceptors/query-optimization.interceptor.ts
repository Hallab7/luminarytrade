import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { QueryAnalyzerService } from '../query-analyzer.service';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Request } from 'express';

@Injectable()
export class QueryOptimizationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(QueryOptimizationInterceptor.name);

  constructor(
    private readonly queryAnalyzer: QueryAnalyzerService,
    @InjectDataSource()
    private readonly dataSource: DataSource
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const startTime = Date.now();
    const request = context.switchToHttp().getRequest<Request>();

    // Hook into query execution
    this.hookIntoQueryExecution(startTime, request);

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.logger.debug(`Request completed in ${duration}ms`, {
          url: request.url,
          method: request.method,
          duration,
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logger.error(`Request failed after ${duration}ms`, error.stack, {
          url: request.url,
          method: request.method,
          duration,
        });
        throw error;
      })
    );
  }

  private hookIntoQueryExecution(startTime: number, request: Request) {
    const originalQuery = this.dataSource.query.bind(this.dataSource);
    
    this.dataSource.query = async (query: string, parameters?: any[]) => {
      const queryStartTime = Date.now();
      
      try {
        const result = await originalQuery(query, parameters);
        const executionTime = Date.now() - queryStartTime;
        
        // Analyze the query
        await this.queryAnalyzer.analyzeQuery(query, executionTime, parameters, result?.length || 0);
        
        return result;
      } catch (error) {
        const executionTime = Date.now() - queryStartTime;
        
        // Analyze failed queries too
        await this.queryAnalyzer.analyzeQuery(query, executionTime, parameters, 0);
        
        throw error;
      }
    };

    // Hook into repository queries
    this.hookIntoRepositories(startTime, request);
  }

  private hookIntoRepositories(startTime: number, request: Request) {
    // This would require more complex instrumentation for TypeORM repositories
    // For now, we'll focus on the main query method
  }
}
