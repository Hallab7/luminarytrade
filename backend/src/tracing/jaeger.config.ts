import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as api from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http';

export interface JaegerConfig {
  enabled: boolean;
  endpoint: string;
  serviceName: string;
  serviceVersion: string;
  environment: string;
  samplingRate: number;
  headers?: Record<string, string>;
  maxBatchSize?: number;
  maxExportTimeoutMs?: number;
}

export interface TracingConfig {
  jaeger: JaegerConfig;
  otlp?: {
    endpoint: string;
    headers?: Record<string, string>;
  };
  instrumentations: {
    http: boolean;
    express: boolean;
    postgresql: boolean;
    redis: boolean;
    bullmq: boolean;
    grpc: boolean;
  };
}

@Injectable()
export class JaegerConfigService {
  constructor(private configService: ConfigService) {}

  getConfig(): TracingConfig {
    const environment = this.configService.get('NODE_ENV', 'development');
    const serviceName = this.configService.get('SERVICE_NAME', 'luminarytrade-backend');
    const serviceVersion = this.configService.get('SERVICE_VERSION', '1.0.0');

    return {
      jaeger: {
        enabled: this.configService.get('JAEGER_ENABLED', 'true') === 'true',
        endpoint: this.configService.get('JAEGER_ENDPOINT', 'http://localhost:14268/api/traces'),
        serviceName,
        serviceVersion,
        environment,
        samplingRate: this.getSamplingRate(environment),
        headers: this.parseHeaders(this.configService.get('JAEGER_HEADERS')),
        maxBatchSize: this.configService.get('JAEGER_MAX_BATCH_SIZE', 512),
        maxExportTimeoutMs: this.configService.get('JAEGER_EXPORT_TIMEOUT', 30000),
      },
      otlp: this.configService.get('OTLP_ENDPOINT') ? {
        endpoint: this.configService.get('OTLP_ENDPOINT'),
        headers: this.parseHeaders(this.configService.get('OTLP_HEADERS')),
      } : undefined,
      instrumentations: {
        http: this.configService.get('TRACING_HTTP_ENABLED', 'true') === 'true',
        express: this.configService.get('TRACING_EXPRESS_ENABLED', 'true') === 'true',
        postgresql: this.configService.get('TRACING_POSTGRESQL_ENABLED', 'true') === 'true',
        redis: this.configService.get('TRACING_REDIS_ENABLED', 'true') === 'true',
        bullmq: this.configService.get('TRACING_BULLMQ_ENABLED', 'true') === 'true',
        grpc: this.configService.get('TRACING_GRPC_ENABLED', 'false') === 'true',
      },
    };
  }

  private getSamplingRate(environment: string): number {
    if (environment === 'production') {
      return parseFloat(this.configService.get('JAEGER_SAMPLING_RATE', '0.1'));
    }
    if (environment === 'staging') {
      return parseFloat(this.configService.get('JAEGER_SAMPLING_RATE', '0.5'));
    }
    return 1.0; // Sample all traces in development
  }

  private parseHeaders(headersString?: string): Record<string, string> {
    if (!headersString) return {};
    
    try {
      return JSON.parse(headersString);
    } catch {
      return {};
    }
  }

  createJaegerExporter(config: JaegerConfig): JaegerExporter {
    return new JaegerExporter({
      endpoint: config.endpoint,
      headers: config.headers,
      maxBatchSize: config.maxBatchSize,
      maxExportTimeoutMs: config.maxExportTimeoutMs,
    });
  }

  createOTLPExporter(config: TracingConfig['otlp']): OTLPTraceExporter | undefined {
    if (!config) return undefined;

    return new OTLPTraceExporter({
      url: config.endpoint,
      headers: config.headers,
    });
  }

  createSampler(samplingRate: number): api.Sampler {
    return new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(samplingRate),
    });
  }

  createResource(config: JaegerConfig): Resource {
    return new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: config.serviceVersion,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.environment,
      'service.instance.id': this.configService.get('SERVICE_INSTANCE_ID', 'unknown'),
      'host.name': this.configService.get('HOSTNAME', 'localhost'),
      'process.pid': process.pid,
    });
  }

  createInstrumentations(config: TracingConfig['instrumentations']) {
    return getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
      '@opentelemetry/instrumentation-http': {
        enabled: config.http,
        requestHook: (span, request) => {
          span.setAttribute('http.request.headers', JSON.stringify({
            'user-agent': request.headers['user-agent'],
            'content-type': request.headers['content-type'],
          }));
          span.setAttribute('http.request.size', request.headers['content-length'] || '0');
        },
        responseHook: (span, response) => {
          span.setAttribute('http.response.size', response.headers['content-length'] || '0');
        },
      },
      '@opentelemetry/instrumentation-express': {
        enabled: config.express,
        requestHook: (span, info) => {
          span.setAttribute('express.route', info.route);
          span.setAttribute('express.type', info.type);
        },
      },
      '@opentelemetry/instrumentation-pg': {
        enabled: config.postgresql,
        enhancedDatabaseReporting: true,
        requestHook: (span, requestInfo) => {
          span.setAttribute('db.statement', requestInfo.sql);
          span.setAttribute('db.operation', requestInfo.operation);
        },
      },
      '@opentelemetry/instrumentation-redis': {
        enabled: config.redis,
        requestHook: (span, cmdName, cmdArgs) => {
          span.setAttribute('redis.command', cmdName);
          span.setAttribute('redis.args_count', cmdArgs.length);
        },
        responseHook: (span, cmdName, cmdArgs, reply) => {
          if (reply) {
            span.setAttribute('redis.response_type', typeof reply);
          }
        },
      },
      '@opentelemetry/instrumentation-bullmq': {
        enabled: config.bullmq,
        producerHook: (span, job) => {
          span.setAttribute('messaging.job.id', job.id);
          span.setAttribute('messaging.job.name', job.name);
          span.setAttribute('messaging.job.data_size', JSON.stringify(job.data).length);
        },
        consumerHook: (span, job) => {
          span.setAttribute('messaging.job.id', job.id);
          span.setAttribute('messaging.job.name', job.name);
          span.setAttribute('messaging.job.attempts_made', job.attemptsMade);
        },
      },
      '@opentelemetry/instrumentation-grpc': {
        enabled: config.grpc,
      },
    });
  }

  createNodeSDK(config: TracingConfig): NodeSDK {
    const jaegerExporter = this.createJaegerExporter(config.jaeger);
    const otlpExporter = this.createOTLPExporter(config.otlp);
    const sampler = this.createSampler(config.jaeger.samplingRate);
    const resource = this.createResource(config.jaeger);
    const instrumentations = this.createInstrumentations(config.instrumentations);

    const spanProcessors = [new BatchSpanProcessor(jaegerExporter)];
    if (otlpExporter) {
      spanProcessors.push(new BatchSpanProcessor(otlpExporter));
    }

    return new NodeSDK({
      resource,
      spanProcessor: spanProcessors.length > 1 ? spanProcessors : spanProcessors[0],
      sampler,
      instrumentations,
      contextManager: new AsyncLocalStorageContextManager().enable(),
      autoDetectResources: true,
    });
  }
}
