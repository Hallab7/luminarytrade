import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as api from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { JaegerConfigService, TracingConfig } from './jaeger.config';

@Injectable()
export class TracingService implements OnModuleInit, OnModuleDestroy {
  private sdk: NodeSDK;
  private tracer: api.Tracer;
  private config: TracingConfig;

  constructor(
    private configService: ConfigService,
    private jaegerConfigService: JaegerConfigService
  ) {}

  async onModuleInit() {
    await this.initializeTracing();
  }

  private async initializeTracing() {
    this.config = this.jaegerConfigService.getConfig();
    const environment = this.configService.get('NODE_ENV', 'development');
    const tracingDisabled = this.configService.get('TRACING_DISABLED', 'false') === 'true';

    if (environment === 'test' || tracingDisabled || !this.config.jaeger.enabled) {
      const provider = new BasicTracerProvider();
      provider.register({
        contextManager: new AsyncLocalStorageContextManager().enable(),
      });
      this.tracer = api.trace.getTracer(this.config.jaeger.serviceName, this.config.jaeger.serviceVersion);
      return;
    }

    // Initialize SDK with configuration
    this.sdk = this.jaegerConfigService.createNodeSDK(this.config);
    await this.sdk.start();
    this.tracer = api.trace.getTracer(this.config.jaeger.serviceName, this.config.jaeger.serviceVersion);

    console.log('🔍 OpenTelemetry tracing initialized');
    console.log(`📊 Service: ${this.config.jaeger.serviceName} v${this.config.jaeger.serviceVersion}`);
    console.log(`🌍 Environment: ${this.config.jaeger.environment}`);
    console.log(`� Sampling rate: ${(this.config.jaeger.samplingRate * 100).toFixed(1)}%`);
    console.log(`� Jaeger endpoint: ${this.config.jaeger.endpoint}`);
  }

  getTracer(): api.Tracer {
    if (!this.tracer) {
      const serviceName = this.configService.get('SERVICE_NAME', 'luminarytrade-backend');
      const serviceVersion = this.configService.get('SERVICE_VERSION', '1.0.0');
      const environment = this.configService.get('NODE_ENV', 'development');

      if (environment === 'test') {
        const provider = new BasicTracerProvider();
        provider.register({
          contextManager: new AsyncLocalStorageContextManager().enable(),
        });
      }

      this.tracer = api.trace.getTracer(serviceName, serviceVersion);
    }
    return this.tracer;
  }

  /**
   * Create a custom span for business logic
   */
  startSpan(name: string, options?: api.SpanOptions): api.Span {
    return this.getTracer().startSpan(name, options);
  }

  /**
   * Execute a function within a span context
   */
  async withSpan<T>(
    name: string,
    fn: (span: api.Span) => Promise<T>,
    options?: api.SpanOptions,
  ): Promise<T> {
    const span = this.startSpan(name, options);
    const context = api.trace.setSpan(api.context.active(), span);

    try {
      const result = await api.context.with(context, () => fn(span));
      span.setStatus({ code: api.SpanStatusCode.OK });
      return result;
    } catch (error) {
      this.recordException(span, error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Get the current active span
   */
  getCurrentSpan(): api.Span | undefined {
    return api.trace.getSpan(api.context.active());
  }

  /**
   * Add attributes to the current span
   */
  addSpanAttributes(attributes: api.Attributes): void {
    const span = this.getCurrentSpan();
    if (span) {
      span.setAttributes(attributes);
    }
  }

  /**
   * Add a single attribute to the current span
   */
  addSpanAttribute(key: string, value: api.AttributeValue): void {
    const span = this.getCurrentSpan();
    if (span) {
      span.setAttribute(key, value);
    }
  }

  /**
   * Add an event to the current span
   */
  addSpanEvent(name: string, attributes?: api.Attributes): void {
    const span = this.getCurrentSpan();
    if (span) {
      span.addEvent(name, attributes);
    }
  }

  /**
   * Record an exception in the current span
   */
  recordException(span: api.Span, error: Error): void {
    span.recordException(error);
    span.setStatus({
      code: api.SpanStatusCode.ERROR,
      message: error.message,
    });
  }

  /**
   * Get trace ID from current context
   */
  getTraceId(): string | undefined {
    const span = this.getCurrentSpan();
    if (span) {
      const spanContext = span.spanContext();
      return spanContext.traceId;
    }
    return undefined;
  }

  /**
   * Get span ID from current context
   */
  getSpanId(): string | undefined {
    const span = this.getCurrentSpan();
    if (span) {
      const spanContext = span.spanContext();
      return spanContext.spanId;
    }
    return undefined;
  }

  /**
   * Inject trace context into carrier (for propagation)
   */
  injectContext(carrier: any): void {
    api.propagation.inject(api.context.active(), carrier);
  }

  /**
   * Extract trace context from carrier
   */
  extractContext(carrier: any): api.Context {
    return api.propagation.extract(api.context.active(), carrier);
  }

  async onModuleDestroy() {
    if (this.sdk) {
      await this.sdk.shutdown();
    }
  }
}
