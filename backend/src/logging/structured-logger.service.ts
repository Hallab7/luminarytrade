import { Injectable, OnModuleInit, OnModuleDestroy, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import { traceContextStorage } from '../common/async-storage';
import { TracingService } from '../tracing/tracing.service';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

@Injectable({ scope: Scope.DEFAULT })
export class StructuredLoggerService implements OnModuleInit, OnModuleDestroy {
  private logger: winston.Logger;

  constructor(
    private configService: ConfigService,
    private tracingService: TracingService
  ) {}

  onModuleInit() {
    const logLevel = this.configService.get('LOG_LEVEL', 'info');
    const serviceName = this.configService.get('SERVICE_NAME', 'luminarytrade-backend');
    const environment = this.configService.get('NODE_ENV', 'development');

    const customFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );

    this.logger = winston.createLogger({
      level: logLevel,
      format: customFormat,
      defaultMeta: {
        service: serviceName,
        env: environment,
      },
      transports: [
        new winston.transports.Console({
          format: environment === 'development' 
            ? winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
              )
            : customFormat,
        }),
      ],
    });
  }

  private getContextMetadata() {
    const store = traceContextStorage.getStore();
    const traceId = this.tracingService.getTraceId();
    const spanId = this.tracingService.getSpanId();

    return {
      correlationId: store?.correlationId,
      userId: store?.userId,
      traceId,
      spanId,
      ...store,
    };
  }

  info(message: string, metadata?: any) {
    this.logger.info(message, { ...this.getContextMetadata(), ...metadata });
  }

  error(message: string, error?: any, metadata?: any) {
    const errorData = error instanceof Error 
      ? { message: error.message, stack: error.stack, name: error.name }
      : { error };

    this.logger.error(message, { 
      ...this.getContextMetadata(), 
      ...errorData,
      ...metadata 
    });
  }

  warn(message: string, metadata?: any) {
    this.logger.warn(message, { ...this.getContextMetadata(), ...metadata });
  }

  debug(message: string, metadata?: any) {
    this.logger.debug(message, { ...this.getContextMetadata(), ...metadata });
  }

  log(message: string, metadata?: any) {
    this.info(message, metadata);
  }

  onModuleDestroy() {
    if (this.logger) {
      this.logger.close();
    }
  }
}
