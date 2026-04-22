import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { register, Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export interface PrometheusConfig {
  enabled: boolean;
  port: number;
  path: string;
  prefix: string;
  labels: Record<string, string>;
  defaultMetricsInterval: number;
}

export interface MetricLabels {
  method?: string;
  route?: string;
  status_code?: string;
  service?: string;
  version?: string;
  environment?: string;
  [key: string]: string | undefined;
}

export interface HistogramOptions {
  name: string;
  help: string;
  labelNames?: string[];
  buckets?: number[];
}

export interface CounterOptions {
  name: string;
  help: string;
  labelNames?: string[];
}

export interface GaugeOptions {
  name: string;
  help: string;
  labelNames?: string[];
}

@Injectable()
export class PrometheusService implements OnModuleInit, OnModuleDestroy {
  private registry: Registry;
  private config: PrometheusConfig;
  private metricsServer: any;
  private defaultMetricsInterval: NodeJS.Timeout;

  // HTTP Request Metrics
  private httpRequestsTotal: Counter<string>;
  private httpRequestDuration: Histogram<string>;
  private httpRequestSize: Histogram<string>;
  private httpResponseSize: Histogram<string>;

  // Database Metrics
  private dbQueriesTotal: Counter<string>;
  private dbQueryDuration: Histogram<string>;
  private dbConnectionsActive: Gauge<string>;
  private dbConnectionsIdle: Gauge<string>;

  // Cache Metrics
  private cacheHitsTotal: Counter<string>;
  private cacheMissesTotal: Counter<string>;
  private cacheHitRatio: Gauge<string>;
  private cacheOperationsTotal: Counter<string>;

  // Job Queue Metrics
  private jobQueueDepth: Gauge<string>;
  private jobProcessingDuration: Histogram<string>;
  private jobProcessingTotal: Counter<string>;
  private jobFailuresTotal: Counter<string>;

  // AI Provider Metrics
  private aiProviderRequestsTotal: Counter<string>;
  private aiProviderResponseDuration: Histogram<string>;
  private aiProviderErrorsTotal: Counter<string>;

  // Business Metrics
  private creditScoresGenerated: Counter<string>;
  private fraudDetectionsTotal: Counter<string>;
  private blockchainSubmissionsTotal: Counter<string>;
  private blockchainSubmissionFailures: Counter<string>;

  // System Metrics
  private memoryUsage: Gauge<string>;
  private cpuUsage: Gauge<string>;
  private activeConnections: Gauge<string>;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.config = this.getConfig();
    
    if (!this.config.enabled) {
      return;
    }

    this.registry = new Registry();
    this.registry.setDefaultLabels(this.config.labels);

    // Initialize metrics
    this.initializeHttpMetrics();
    this.initializeDatabaseMetrics();
    this.initializeCacheMetrics();
    this.initializeJobQueueMetrics();
    this.initializeAIProviderMetrics();
    this.initializeBusinessMetrics();
    this.initializeSystemMetrics();

    // Collect default Node.js metrics
    collectDefaultMetrics({
      register: this.registry,
      prefix: this.config.prefix,
    });

    // Start metrics collection interval
    this.startDefaultMetricsCollection();

    console.log('📊 Prometheus metrics initialized');
    console.log(`🔗 Metrics endpoint: http://localhost:${this.config.port}${this.config.path}`);
  }

  private getConfig(): PrometheusConfig {
    return {
      enabled: this.configService.get('PROMETHEUS_ENABLED', 'true') === 'true',
      port: parseInt(this.configService.get('PROMETHEUS_PORT', '9090')),
      path: this.configService.get('PROMETHEUS_PATH', '/metrics'),
      prefix: this.configService.get('PROMETHEUS_PREFIX', 'luminarytrade_'),
      labels: {
        service: this.configService.get('SERVICE_NAME', 'luminarytrade-backend'),
        version: this.configService.get('SERVICE_VERSION', '1.0.0'),
        environment: this.configService.get('NODE_ENV', 'development'),
        instance: this.configService.get('SERVICE_INSTANCE_ID', 'unknown'),
      },
      defaultMetricsInterval: parseInt(this.configService.get('PROMETHEUS_DEFAULT_METRICS_INTERVAL', '15000')),
    };
  }

  private initializeHttpMetrics() {
    this.httpRequestsTotal = new Counter({
      name: `${this.config.prefix}http_requests_total`,
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code', 'service'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: `${this.config.prefix}http_request_duration_seconds`,
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code', 'service'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.httpRequestSize = new Histogram({
      name: `${this.config.prefix}http_request_size_bytes`,
      help: 'HTTP request size in bytes',
      labelNames: ['method', 'route', 'service'],
      buckets: [100, 500, 1000, 5000, 10000, 50000, 100000],
      registers: [this.registry],
    });

    this.httpResponseSize = new Histogram({
      name: `${this.config.prefix}http_response_size_bytes`,
      help: 'HTTP response size in bytes',
      labelNames: ['method', 'route', 'status_code', 'service'],
      buckets: [100, 500, 1000, 5000, 10000, 50000, 100000],
      registers: [this.registry],
    });
  }

  private initializeDatabaseMetrics() {
    this.dbQueriesTotal = new Counter({
      name: `${this.config.prefix}db_queries_total`,
      help: 'Total number of database queries',
      labelNames: ['operation', 'table', 'service'],
      registers: [this.registry],
    });

    this.dbQueryDuration = new Histogram({
      name: `${this.config.prefix}db_query_duration_seconds`,
      help: 'Database query duration in seconds',
      labelNames: ['operation', 'table', 'service'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.dbConnectionsActive = new Gauge({
      name: `${this.config.prefix}db_connections_active`,
      help: 'Number of active database connections',
      labelNames: ['database', 'service'],
      registers: [this.registry],
    });

    this.dbConnectionsIdle = new Gauge({
      name: `${this.config.prefix}db_connections_idle`,
      help: 'Number of idle database connections',
      labelNames: ['database', 'service'],
      registers: [this.registry],
    });
  }

  private initializeCacheMetrics() {
    this.cacheHitsTotal = new Counter({
      name: `${this.config.prefix}cache_hits_total`,
      help: 'Total number of cache hits',
      labelNames: ['cache_type', 'service'],
      registers: [this.registry],
    });

    this.cacheMissesTotal = new Counter({
      name: `${this.config.prefix}cache_misses_total`,
      help: 'Total number of cache misses',
      labelNames: ['cache_type', 'service'],
      registers: [this.registry],
    });

    this.cacheHitRatio = new Gauge({
      name: `${this.config.prefix}cache_hit_ratio`,
      help: 'Cache hit ratio (0-1)',
      labelNames: ['cache_type', 'service'],
      registers: [this.registry],
    });

    this.cacheOperationsTotal = new Counter({
      name: `${this.config.prefix}cache_operations_total`,
      help: 'Total number of cache operations',
      labelNames: ['operation', 'cache_type', 'service'],
      registers: [this.registry],
    });
  }

  private initializeJobQueueMetrics() {
    this.jobQueueDepth = new Gauge({
      name: `${this.config.prefix}job_queue_depth`,
      help: 'Number of jobs in queue',
      labelNames: ['queue_name', 'priority', 'service'],
      registers: [this.registry],
    });

    this.jobProcessingDuration = new Histogram({
      name: `${this.config.prefix}job_processing_duration_seconds`,
      help: 'Job processing duration in seconds',
      labelNames: ['job_type', 'queue_name', 'service'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
      registers: [this.registry],
    });

    this.jobProcessingTotal = new Counter({
      name: `${this.config.prefix}job_processing_total`,
      help: 'Total number of jobs processed',
      labelNames: ['job_type', 'status', 'service'],
      registers: [this.registry],
    });

    this.jobFailuresTotal = new Counter({
      name: `${this.config.prefix}job_failures_total`,
      help: 'Total number of job failures',
      labelNames: ['job_type', 'error_type', 'service'],
      registers: [this.registry],
    });
  }

  private initializeAIProviderMetrics() {
    this.aiProviderRequestsTotal = new Counter({
      name: `${this.config.prefix}ai_provider_requests_total`,
      help: 'Total number of AI provider requests',
      labelNames: ['provider', 'model', 'service'],
      registers: [this.registry],
    });

    this.aiProviderResponseDuration = new Histogram({
      name: `${this.config.prefix}ai_provider_response_duration_seconds`,
      help: 'AI provider response duration in seconds',
      labelNames: ['provider', 'model', 'service'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
      registers: [this.registry],
    });

    this.aiProviderErrorsTotal = new Counter({
      name: `${this.config.prefix}ai_provider_errors_total`,
      help: 'Total number of AI provider errors',
      labelNames: ['provider', 'model', 'error_type', 'service'],
      registers: [this.registry],
    });
  }

  private initializeBusinessMetrics() {
    this.creditScoresGenerated = new Counter({
      name: `${this.config.prefix}credit_scores_generated_total`,
      help: 'Total number of credit scores generated',
      labelNames: ['score_range', 'service'],
      registers: [this.registry],
    });

    this.fraudDetectionsTotal = new Counter({
      name: `${this.config.prefix}fraud_detections_total`,
      help: 'Total number of fraud detections',
      labelNames: ['risk_level', 'service'],
      registers: [this.registry],
    });

    this.blockchainSubmissionsTotal = new Counter({
      name: `${this.config.prefix}blockchain_submissions_total`,
      help: 'Total number of blockchain submissions',
      labelNames: ['network', 'service'],
      registers: [this.registry],
    });

    this.blockchainSubmissionFailures = new Counter({
      name: `${this.config.prefix}blockchain_submission_failures_total`,
      help: 'Total number of blockchain submission failures',
      labelNames: ['network', 'error_type', 'service'],
      registers: [this.registry],
    });
  }

  private initializeSystemMetrics() {
    this.memoryUsage = new Gauge({
      name: `${this.config.prefix}memory_usage_bytes`,
      help: 'Memory usage in bytes',
      labelNames: ['type', 'service'],
      registers: [this.registry],
    });

    this.cpuUsage = new Gauge({
      name: `${this.config.prefix}cpu_usage_percent`,
      help: 'CPU usage percentage',
      labelNames: ['service'],
      registers: [this.registry],
    });

    this.activeConnections = new Gauge({
      name: `${this.config.prefix}active_connections`,
      help: 'Number of active connections',
      labelNames: ['type', 'service'],
      registers: [this.registry],
    });
  }

  private startDefaultMetricsCollection() {
    this.defaultMetricsInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, this.config.defaultMetricsInterval);
  }

  private collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    this.memoryUsage.set({ type: 'rss' }, memUsage.rss);
    this.memoryUsage.set({ type: 'heap_used' }, memUsage.heapUsed);
    this.memoryUsage.set({ type: 'heap_total' }, memUsage.heapTotal);
    this.memoryUsage.set({ type: 'external' }, memUsage.external);
  }

  // HTTP Metrics Methods
  incrementHttpRequests(labels: MetricLabels) {
    this.httpRequestsTotal.inc(labels);
  }

  observeHttpRequestDuration(duration: number, labels: MetricLabels) {
    this.httpRequestDuration.observe(labels, duration);
  }

  observeHttpRequestSize(size: number, labels: MetricLabels) {
    this.httpRequestSize.observe(labels, size);
  }

  observeHttpResponseSize(size: number, labels: MetricLabels) {
    this.httpResponseSize.observe(labels, size);
  }

  // Database Metrics Methods
  incrementDbQueries(labels: MetricLabels) {
    this.dbQueriesTotal.inc(labels);
  }

  observeDbQueryDuration(duration: number, labels: MetricLabels) {
    this.dbQueryDuration.observe(labels, duration);
  }

  setDbConnectionsActive(count: number, labels: MetricLabels) {
    this.dbConnectionsActive.set(labels, count);
  }

  setDbConnectionsIdle(count: number, labels: MetricLabels) {
    this.dbConnectionsIdle.set(labels, count);
  }

  // Cache Metrics Methods
  incrementCacheHits(labels: MetricLabels) {
    this.cacheHitsTotal.inc(labels);
  }

  incrementCacheMisses(labels: MetricLabels) {
    this.cacheMissesTotal.inc(labels);
  }

  setCacheHitRatio(ratio: number, labels: MetricLabels) {
    this.cacheHitRatio.set(labels, ratio);
  }

  incrementCacheOperations(labels: MetricLabels) {
    this.cacheOperationsTotal.inc(labels);
  }

  // Job Queue Metrics Methods
  setJobQueueDepth(depth: number, labels: MetricLabels) {
    this.jobQueueDepth.set(labels, depth);
  }

  observeJobProcessingDuration(duration: number, labels: MetricLabels) {
    this.jobProcessingDuration.observe(labels, duration);
  }

  incrementJobProcessing(labels: MetricLabels) {
    this.jobProcessingTotal.inc(labels);
  }

  incrementJobFailures(labels: MetricLabels) {
    this.jobFailuresTotal.inc(labels);
  }

  // AI Provider Metrics Methods
  incrementAIProviderRequests(labels: MetricLabels) {
    this.aiProviderRequestsTotal.inc(labels);
  }

  observeAIProviderResponseDuration(duration: number, labels: MetricLabels) {
    this.aiProviderResponseDuration.observe(labels, duration);
  }

  incrementAIProviderErrors(labels: MetricLabels) {
    this.aiProviderErrorsTotal.inc(labels);
  }

  // Business Metrics Methods
  incrementCreditScoresGenerated(labels: MetricLabels) {
    this.creditScoresGenerated.inc(labels);
  }

  incrementFraudDetections(labels: MetricLabels) {
    this.fraudDetectionsTotal.inc(labels);
  }

  incrementBlockchainSubmissions(labels: MetricLabels) {
    this.blockchainSubmissionsTotal.inc(labels);
  }

  incrementBlockchainSubmissionFailures(labels: MetricLabels) {
    this.blockchainSubmissionFailures.inc(labels);
  }

  // System Metrics Methods
  setActiveConnections(count: number, labels: MetricLabels) {
    this.activeConnections.set(labels, count);
  }

  // Utility Methods
  getRegistry(): Registry {
    return this.registry;
  }

  getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  createCounter(options: CounterOptions): Counter<string> {
    return new Counter({
      ...options,
      name: `${this.config.prefix}${options.name}`,
      registers: [this.registry],
    });
  }

  createHistogram(options: HistogramOptions): Histogram<string> {
    return new Histogram({
      ...options,
      name: `${this.config.prefix}${options.name}`,
      registers: [this.registry],
    });
  }

  createGauge(options: GaugeOptions): Gauge<string> {
    return new Gauge({
      ...options,
      name: `${this.config.prefix}${options.name}`,
      registers: [this.registry],
    });
  }

  async onModuleDestroy() {
    if (this.defaultMetricsInterval) {
      clearInterval(this.defaultMetricsInterval);
    }
    
    if (this.metricsServer) {
      await this.metricsServer.close();
    }
  }
}
