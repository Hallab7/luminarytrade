import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import * as Elasticsearch from 'winston-elasticsearch';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

export interface LogContext {
  userId?: string;
  traceId?: string;
  spanId?: string;
  requestId?: string;
  sessionId?: string;
  service?: string;
  version?: string;
  environment?: string;
  instanceId?: string;
  [key: string]: any;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
  timestamp: Date;
  error?: Error;
  metadata?: Record<string, any>;
}

export interface ELKConfig {
  enabled: boolean;
  elasticsearch: {
    url: string;
    index: string;
    username?: string;
    password?: string;
    maxRetries?: number;
    requestTimeout?: number;
    deadTimeout?: number;
  };
  logstash?: {
    enabled: boolean;
    host: string;
    port: number;
    maxConnections?: number;
  };
  kibana?: {
    url: string;
    indexPattern: string;
  };
  logging: {
    level: LogLevel;
    format: 'json' | 'text';
    console: boolean;
    file?: {
      enabled: boolean;
      filename: string;
      maxSize: string;
      maxFiles: number;
    };
  };
}

@Injectable()
export class ELKLoggerService implements OnModuleInit, OnModuleDestroy {
  private logger: winston.Logger;
  private config: ELKConfig;
  private elasticsearchTransport: any;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.config = this.getConfig();
    
    if (!this.config.enabled) {
      // Fallback to basic console logging
      this.logger = winston.createLogger({
        level: this.config.logging.level,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        ),
        transports: [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            )
          })
        ]
      });
      return;
    }

    await this.initializeLogger();
    console.log('📝 ELK Logger initialized');
    console.log(`🔗 Elasticsearch: ${this.config.elasticsearch.url}`);
    console.log(`📊 Index: ${this.config.elasticsearch.index}`);
  }

  private getConfig(): ELKConfig {
    return {
      enabled: this.configService.get('ELK_ENABLED', 'true') === 'true',
      elasticsearch: {
        url: this.configService.get('ELASTICSEARCH_URL', 'http://localhost:9200'),
        index: this.configService.get('ELASTICSEARCH_INDEX', 'luminarytrade-logs'),
        username: this.configService.get('ELASTICSEARCH_USERNAME'),
        password: this.configService.get('ELASTICSEARCH_PASSWORD'),
        maxRetries: parseInt(this.configService.get('ELASTICSEARCH_MAX_RETRIES', '3')),
        requestTimeout: parseInt(this.configService.get('ELASTICSEARCH_REQUEST_TIMEOUT', '30000')),
        deadTimeout: parseInt(this.configService.get('ELASTICSEARCH_DEAD_TIMEOUT', '300000')),
      },
      logstash: {
        enabled: this.configService.get('LOGSTASH_ENABLED', 'false') === 'true',
        host: this.configService.get('LOGSTASH_HOST', 'localhost'),
        port: parseInt(this.configService.get('LOGSTASH_PORT', '5000')),
        maxConnections: parseInt(this.configService.get('LOGSTASH_MAX_CONNECTIONS', '10')),
      },
      kibana: {
        url: this.configService.get('KIBANA_URL', 'http://localhost:5601'),
        indexPattern: this.configService.get('KIBANA_INDEX_PATTERN', 'luminarytrade-*'),
      },
      logging: {
        level: (this.configService.get('LOG_LEVEL', 'info') as LogLevel),
        format: (this.configService.get('LOG_FORMAT', 'json') as 'json' | 'text'),
        console: this.configService.get('LOG_CONSOLE', 'true') === 'true',
        file: this.configService.get('LOG_FILE_ENABLED', 'false') === 'true' ? {
          enabled: true,
          filename: this.configService.get('LOG_FILE_FILENAME', 'logs/app.log'),
          maxSize: this.configService.get('LOG_FILE_MAX_SIZE', '20m'),
          maxFiles: parseInt(this.configService.get('LOG_FILE_MAX_FILES', '14')),
        } : undefined,
      },
    };
  }

  private async initializeLogger() {
    const transports: winston.transport[] = [];

    // Elasticsearch transport
    if (this.config.elasticsearch.url) {
      this.elasticsearchTransport = new Elasticsearch({
        level: this.config.logging.level,
        clientOpts: {
          node: this.config.elasticsearch.url,
          auth: this.config.elasticsearch.username && this.config.elasticsearch.password ? {
            username: this.config.elasticsearch.username,
            password: this.config.elasticsearch.password
          } : undefined,
          maxRetries: this.config.elasticsearch.maxRetries,
          requestTimeout: this.config.elasticsearch.requestTimeout,
          deadTimeout: this.config.elasticsearch.deadTimeout,
        },
        index: this.config.elasticsearch.index,
        transformer: (logData: any) => {
          return this.transformLogData(logData);
        },
      });
      transports.push(this.elasticsearchTransport);
    }

    // Console transport
    if (this.config.logging.console) {
      transports.push(new winston.transports.Console({
        format: this.config.logging.format === 'json' 
          ? winston.format.combine(
              winston.format.timestamp(),
              winston.format.errors({ stack: true }),
              winston.format.json()
            )
          : winston.format.combine(
              winston.format.colorize(),
              winston.format.timestamp(),
              winston.format.printf(({ timestamp, level, message, context, error, ...meta }) => {
                let log = `${timestamp} [${level}] ${message}`;
                
                if (context && Object.keys(context).length > 0) {
                  log += ` Context: ${JSON.stringify(context)}`;
                }
                
                if (error) {
                  log += ` Error: ${error.stack || error.message}`;
                }
                
                if (Object.keys(meta).length > 0) {
                  log += ` Meta: ${JSON.stringify(meta)}`;
                }
                
                return log;
              })
            )
      }));
    }

    // File transport
    if (this.config.logging.file?.enabled) {
      transports.push(new winston.transports.File({
        filename: this.config.logging.file.filename,
        maxsize: this.parseSize(this.config.logging.file.maxSize),
        maxFiles: this.config.logging.file.maxFiles,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      }));
    }

    this.logger = winston.createLogger({
      level: this.config.logging.level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports,
      defaultMeta: {
        service: this.configService.get('SERVICE_NAME', 'luminarytrade-backend'),
        version: this.configService.get('SERVICE_VERSION', '1.0.0'),
        environment: this.configService.get('NODE_ENV', 'development'),
        instanceId: this.configService.get('SERVICE_INSTANCE_ID', 'unknown'),
      }
    });
  }

  private transformLogData(logData: any): any {
    const transformed = {
      '@timestamp': logData.timestamp || new Date().toISOString(),
      level: logData.level,
      message: logData.message,
      service: logData.service,
      version: logData.version,
      environment: logData.environment,
      instanceId: logData.instanceId,
    };

    // Add context if present
    if (logData.context) {
      transformed.context = logData.context;
    }

    // Add error information if present
    if (logData.error) {
      transformed.error = {
        name: logData.error.name,
        message: logData.error.message,
        stack: logData.error.stack,
      };
    }

    // Add any additional metadata
    Object.keys(logData).forEach(key => {
      if (!['timestamp', 'level', 'message', 'service', 'version', 'environment', 'instanceId', 'context', 'error'].includes(key)) {
        transformed[key] = logData[key];
      }
    });

    return transformed;
  }

  private parseSize(sizeStr: string): number {
    const units: Record<string, number> = {
      'b': 1,
      'k': 1024,
      'm': 1024 * 1024,
      'g': 1024 * 1024 * 1024,
    };
    
    const match = sizeStr.toLowerCase().match(/^(\d+)([bkmg]?)$/);
    if (!match) return 20 * 1024 * 1024; // Default 20MB
    
    const [, size, unit] = match;
    return parseInt(size) * (units[unit] || 1);
  }

  // Logging methods
  debug(message: string, context?: LogContext, metadata?: Record<string, any>) {
    this.logger.debug(message, { context, ...metadata });
  }

  info(message: string, context?: LogContext, metadata?: Record<string, any>) {
    this.logger.info(message, { context, ...metadata });
  }

  warn(message: string, context?: LogContext, metadata?: Record<string, any>) {
    this.logger.warn(message, { context, ...metadata });
  }

  error(message: string, error?: Error, context?: LogContext, metadata?: Record<string, any>) {
    this.logger.error(message, { error, context, ...metadata });
  }

  fatal(message: string, error?: Error, context?: LogContext, metadata?: Record<string, any>) {
    this.logger.error(`FATAL: ${message}`, { error, context, ...metadata });
  }

  // Structured logging methods
  logHttpRequest(req: any, res: any, duration: number) {
    this.info('HTTP Request', {
      requestId: req.id,
      traceId: req.traceId,
      spanId: req.spanId,
      userId: req.user?.id,
    }, {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  }

  logDatabaseQuery(query: string, duration: number, context?: LogContext) {
    this.debug('Database Query', context, {
      query,
      duration,
      operation: this.extractOperation(query),
    });
  }

  logJobProcessing(jobType: string, jobId: string, duration: number, status: string, error?: Error) {
    const logData: any = {
      jobType,
      jobId,
      duration,
      status,
    };

    if (error) {
      this.error(`Job Processing Failed: ${jobType}`, error, undefined, logData);
    } else {
      this.info(`Job Processing Completed: ${jobType}`, undefined, logData);
    }
  }

  logAIProviderCall(provider: string, model: string, duration: number, success: boolean, error?: Error) {
    const logData: any = {
      provider,
      model,
      duration,
      success,
    };

    if (error) {
      this.error(`AI Provider Call Failed: ${provider}`, error, undefined, logData);
    } else {
      this.info(`AI Provider Call Completed: ${provider}`, undefined, logData);
    }
  }

  logCacheOperation(operation: string, key: string, hit: boolean, context?: LogContext) {
    this.debug(`Cache ${operation}`, context, {
      key,
      hit,
    });
  }

  logBlockchainOperation(network: string, operation: string, txHash?: string, success: boolean, error?: Error) {
    const logData: any = {
      network,
      operation,
      success,
    };

    if (txHash) {
      logData.txHash = txHash;
    }

    if (error) {
      this.error(`Blockchain Operation Failed: ${operation}`, error, undefined, logData);
    } else {
      this.info(`Blockchain Operation Completed: ${operation}`, undefined, logData);
    }
  }

  logBusinessEvent(event: string, data: any, context?: LogContext) {
    this.info(`Business Event: ${event}`, context, data);
  }

  logSecurityEvent(event: string, severity: 'low' | 'medium' | 'high' | 'critical', context?: LogContext, metadata?: Record<string, any>) {
    this.warn(`Security Event: ${event}`, context, {
      severity,
      ...metadata,
    });
  }

  logPerformanceMetric(metric: string, value: number, unit: string, context?: LogContext) {
    this.info(`Performance Metric: ${metric}`, context, {
      value,
      unit,
    });
  }

  // Utility methods
  private extractOperation(query: string): string {
    const operations = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER'];
    for (const op of operations) {
      if (query.toUpperCase().startsWith(op)) {
        return op;
      }
    }
    return 'UNKNOWN';
  }

  // Health check method
  async isHealthy(): Promise<boolean> {
    if (!this.elasticsearchTransport) {
      return false;
    }

    try {
      // Try to ping Elasticsearch
      await this.elasticsearchTransport.client.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Get logger instance for custom use
  getLogger(): winston.Logger {
    return this.logger;
  }

  async onModuleDestroy() {
    if (this.logger) {
      this.logger.close();
    }
  }
}
