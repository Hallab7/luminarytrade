# Comprehensive Monitoring and Observability Stack

This document provides a complete guide to the monitoring and observability stack implemented for the LuminaryTrade backend application.

## Overview

The observability stack consists of four main components:

1. **Distributed Tracing** with Jaeger
2. **Metrics Collection** with Prometheus
3. **Centralized Logging** with ELK Stack
4. **Alerting** with AlertManager

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Application   │───▶│   Tracing (OTLP) │───▶│     Jaeger      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Metrics API   │───▶│   Prometheus     │───▶│    Grafana      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Logs (JSON)   │───▶│  ELK Stack       │───▶│     Kibana      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Alert Rules   │───▶│  AlertManager    │───▶│ Notifications  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 1. Distributed Tracing with Jaeger

### Configuration

The tracing system is configured using OpenTelemetry with Jaeger as the backend.

**Environment Variables:**
```bash
# Enable/disable tracing
TRACING_DISABLED=false

# Jaeger configuration
JAEGER_ENABLED=true
JAEGER_ENDPOINT=http://localhost:14268/api/traces
JAEGER_SAMPLING_RATE=1.0

# Service information
SERVICE_NAME=luminarytrade-backend
SERVICE_VERSION=1.0.0
SERVICE_INSTANCE_ID=app-1

# Instrumentation settings
TRACING_HTTP_ENABLED=true
TRACING_EXPRESS_ENABLED=true
TRACING_POSTGRESQL_ENABLED=true
TRACING_REDIS_ENABLED=true
TRACING_BULLMQ_ENABLED=true
```

### Usage Examples

#### Manual Tracing

```typescript
import { TracingService } from './tracing/tracing.service';

@Injectable()
export class LoanService {
  constructor(private tracing: TracingService) {}

  async processLoan(loanId: string) {
    return await this.tracing.withSpan('process-loan', async (span) => {
      span.setAttribute('loan.id', loanId);
      span.setAttribute('loan.type', 'personal');
      
      // Business logic here
      const result = await this.doLoanProcessing(loanId);
      
      span.addEvent('processing-completed', {
        'loan.amount': result.amount,
        'loan.status': result.status
      });
      
      return result;
    });
  }
}
```

#### Decorator-based Tracing

```typescript
import { Monitored } from './metrics/decorators/monitored.decorator';

@Injectable()
export class ScoringService {
  @Monitored({
    name: 'credit-scoring',
    trackDuration: true,
    trackErrors: true
  })
  async calculateCreditScore(applicationId: string): Promise<number> {
    // Automatic tracing and metrics collection
    return this.performScoring(applicationId);
  }
}
```

### Trace Context Propagation

The system automatically propagates trace context through HTTP headers:

- `uber-trace-id`: Jaeger trace ID
- `x-trace-id`: Custom trace ID
- `x-span-id`: Span ID

## 2. Metrics Collection with Prometheus

### Configuration

**Environment Variables:**
```bash
# Prometheus configuration
PROMETHEUS_ENABLED=true
PROMETHEUS_PORT=9090
PROMETHEUS_PATH=/metrics
PROMETHEUS_PREFIX=luminarytrade_
PROMETHEUS_DEFAULT_METRICS_INTERVAL=15000
```

### Available Metrics

#### HTTP Metrics
- `luminarytrade_http_requests_total`: Total HTTP requests
- `luminarytrade_http_request_duration_seconds`: Request duration histogram
- `luminarytrade_http_request_size_bytes`: Request size histogram
- `luminarytrade_http_response_size_bytes`: Response size histogram

#### Database Metrics
- `luminarytrade_db_queries_total`: Database query counter
- `luminarytrade_db_query_duration_seconds`: Query duration histogram
- `luminarytrade_db_connections_active`: Active connections gauge
- `luminarytrade_db_connections_idle`: Idle connections gauge

#### Cache Metrics
- `luminarytrade_cache_hits_total`: Cache hits counter
- `luminarytrade_cache_misses_total`: Cache misses counter
- `luminarytrade_cache_hit_ratio`: Cache hit ratio gauge
- `luminarytrade_cache_operations_total`: Cache operations counter

#### Job Queue Metrics
- `luminarytrade_job_queue_depth`: Queue depth gauge
- `luminarytrade_job_processing_duration_seconds`: Processing duration histogram
- `luminarytrade_job_processing_total`: Jobs processed counter
- `luminarytrade_job_failures_total`: Job failures counter

#### AI Provider Metrics
- `luminarytrade_ai_provider_requests_total`: AI requests counter
- `luminarytrade_ai_provider_response_duration_seconds`: Response duration histogram
- `luminarytrade_ai_provider_errors_total`: AI errors counter

#### Business Metrics
- `luminarytrade_credit_scores_generated_total`: Credit scores generated
- `luminarytrade_fraud_detections_total`: Fraud detections
- `luminarytrade_blockchain_submissions_total`: Blockchain submissions
- `luminarytrade_blockchain_submission_failures_total`: Blockchain failures

### Usage Examples

#### Manual Metrics Recording

```typescript
import { PrometheusService } from './metrics/prometheus.service';

@Injectable()
export class PaymentService {
  constructor(private prometheus: PrometheusService) {}

  async processPayment(paymentId: string, amount: number) {
    const startTime = Date.now();
    
    try {
      // Process payment
      const result = await this.doPaymentProcessing(paymentId, amount);
      
      // Record success metrics
      this.prometheus.incrementBlockchainSubmissions({
        network: 'stellar',
        service: 'luminarytrade-backend'
      });
      
      return result;
    } catch (error) {
      // Record failure metrics
      this.prometheus.incrementBlockchainSubmissionFailures({
        network: 'stellar',
        error_type: error.constructor.name,
        service: 'luminarytrade-backend'
      });
      
      throw error;
    } finally {
      // Record processing duration
      const duration = (Date.now() - startTime) / 1000;
      this.prometheus.observeJobProcessingDuration(duration, {
        job_type: 'payment_processing',
        queue_name: 'payments',
        service: 'luminarytrade-backend'
      });
    }
  }
}
```

#### Custom Metrics

```typescript
// Create custom counter
const customCounter = this.prometheus.createCounter({
  name: 'custom_operations_total',
  help: 'Total number of custom operations',
  labelNames: ['operation_type', 'status']
});

// Create custom histogram
const customHistogram = this.prometheus.createHistogram({
  name: 'custom_operation_duration_seconds',
  help: 'Duration of custom operations',
  labelNames: ['operation_type'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

// Use custom metrics
customCounter.inc({ operation_type: 'data_export', status: 'success' });
customHistogram.observe(1.5, { operation_type: 'data_export' });
```

## 3. Centralized Logging with ELK Stack

### Configuration

**Environment Variables:**
```bash
# ELK Configuration
ELK_ENABLED=true
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX=luminarytrade-logs
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=changeme

# Logging Configuration
LOG_LEVEL=info
LOG_FORMAT=json
LOG_CONSOLE=true

# File Logging (optional)
LOG_FILE_ENABLED=false
LOG_FILE_FILENAME=logs/app.log
LOG_FILE_MAX_SIZE=20m
LOG_FILE_MAX_FILES=14
```

### Log Structure

All logs are structured JSON with the following fields:

```json
{
  "@timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Request completed successfully",
  "service": "luminarytrade-backend",
  "version": "1.0.0",
  "environment": "development",
  "instanceId": "app-1",
  "context": {
    "requestId": "req_123456",
    "traceId": "trace_789",
    "spanId": "span_456",
    "userId": "user_123"
  },
  "metadata": {
    "method": "GET",
    "url": "/api/loans/123",
    "statusCode": 200,
    "duration": 150
  }
}
```

### Usage Examples

#### Basic Logging

```typescript
import { ELKLoggerService } from './logging/elk-logger.service';

@Injectable()
export class UserService {
  constructor(private logger: ELKLoggerService) {}

  async createUser(userData: any) {
    const context = {
      userId: userData.id,
      traceId: this.getCurrentTraceId(),
      spanId: this.getCurrentSpanId()
    };

    this.logger.info('Creating new user', context, {
      userType: userData.type,
      source: 'web'
    });

    try {
      const user = await this.saveUser(userData);
      
      this.logger.info('User created successfully', context, {
        userId: user.id,
        userType: user.type
      });
      
      return user;
    } catch (error) {
      this.logger.error('Failed to create user', error, context, {
        userType: userData.type,
        errorReason: error.message
      });
      throw error;
    }
  }
}
```

#### Structured Logging Methods

```typescript
// HTTP request logging
this.logger.logHttpRequest(request, response, duration);

// Database query logging
this.logger.logDatabaseQuery('SELECT * FROM users', 25, context);

// Job processing logging
this.logger.logJobProcessing('ScoreAgent', 'job_123', 2000, 'completed');

// AI provider logging
this.logger.logAIProviderCall('openai', 'gpt-4', 1500, true);

// Cache operation logging
this.logger.logCacheOperation('get', 'user:123', true, context);

// Blockchain operation logging
this.logger.logBlockchainOperation('stellar', 'submit', 'tx_456', true);

// Business event logging
this.logger.logBusinessEvent('loan_approved', { loanId: '123', amount: 10000 });

// Security event logging
this.logger.logSecurityEvent('suspicious_login', 'high', context, {
  ip: '192.168.1.1',
  userAgent: 'suspicious'
});

// Performance metric logging
this.logger.logPerformanceMetric('response_time', 150, 'ms', context);
```

## 4. Alerting with AlertManager

### Configuration

**Environment Variables:**
```bash
# Alerting Configuration
ALERTING_ENABLED=true
ALERTING_EVALUATION_INTERVAL=30

# Email Alerts
ALERT_EMAIL_ENABLED=true
ALERT_EMAIL_SMTP_HOST=smtp.gmail.com
ALERT_EMAIL_SMTP_PORT=587
ALERT_EMAIL_USER=alerts@luminarytrade.com
ALERT_EMAIL_PASS=password
ALERT_EMAIL_FROM=alerts@luminarytrade.com
ALERT_EMAIL_TO=devops@luminarytrade.com

# Slack Alerts
ALERT_SLACK_ENABLED=true
ALERT_SLACK_WEBHOOK=https://hooks.slack.com/services/...
ALERT_SLACK_CHANNEL=#alerts
ALERT_SLACK_USERNAME=LuminaryTrade Bot
```

### Predefined Alert Rules

1. **High Error Rate** - Error rate > 5% for 5 minutes
2. **High P99 Latency** - P99 response time > 2 seconds for 5 minutes
3. **Blockchain Failures** - Failure rate > 10% for 10 minutes
4. **Job Queue Depth** - Queue depth > 1000 jobs for 5 minutes
5. **Database Connections** - Active connections > 80 for 5 minutes
6. **Memory Usage** - Memory usage > 80% for 5 minutes
7. **AI Provider Errors** - Error rate > 15% for 5 minutes

### Custom Alert Rules

```typescript
import { AlertingService } from './alerting/alerting.service';

// Add custom alert rule
await this.alertingService.addRule({
  id: 'custom-business-metric',
  name: 'Custom Business Metric Alert',
  description: 'Alert when custom metric exceeds threshold',
  enabled: true,
  severity: 'medium',
  condition: {
    metric: 'custom_business_metric',
    operator: '>',
    threshold: 100,
    duration: 300
  },
  actions: [
    { type: 'log', config: { level: 'warn' } },
    { type: 'webhook', config: { url: 'https://api.example.com/alerts' } }
  ],
  cooldown: 600,
  evaluationInterval: 60
});
```

## 5. Docker Setup

### Quick Start

```bash
# Start the complete monitoring stack
docker-compose -f docker-compose.monitoring.yml up -d

# View services
docker-compose -f docker-compose.monitoring.yml ps

# View logs
docker-compose -f docker-compose.monitoring.yml logs -f

# Stop services
docker-compose -f docker-compose.monitoring.yml down
```

### Service URLs

After starting the stack, access the following URLs:

- **Application**: http://localhost:3000
- **Jaeger UI**: http://localhost:16686
- **Prometheus**: http://localhost:9091
- **Grafana**: http://localhost:3001 (admin/admin)
- **Kibana**: http://localhost:5601
- **AlertManager**: http://localhost:9093

## 6. Grafana Dashboards

### Pre-built Dashboards

1. **Application Overview**
   - HTTP request metrics
   - Error rates and latency
   - Active users and requests

2. **Database Performance**
   - Query performance
   - Connection pool metrics
   - Slow query analysis

3. **Job Queue Monitoring**
   - Queue depth and processing time
   - Job success/failure rates
   - Worker performance

4. **AI Provider Performance**
   - Response times and error rates
   - Provider comparison
   - Cost tracking

5. **Business Metrics**
   - Credit scores and fraud detection
   - Blockchain submissions
   - User activity

### Dashboard Configuration

Dashboards are automatically provisioned through Grafana's auto-provisioning feature. Configuration files are located in:

```
monitoring/grafana/provisioning/
├── datasources/
│   └── prometheus.yml
├── dashboards/
│   └── dashboard.yml
└── dashboards/
    ├── application-overview.json
    ├── database-performance.json
    ├── job-queue-monitoring.json
    ├── ai-provider-performance.json
    └── business-metrics.json
```

## 7. Performance Considerations

### Monitoring Overhead

The monitoring stack is designed to add less than 5% performance overhead:

- **Tracing**: Sampling-based (configurable sampling rate)
- **Metrics**: Asynchronous collection
- **Logging**: Batched writes to Elasticsearch
- **Alerting**: Efficient evaluation with caching

### Optimization Tips

1. **Adjust Sampling Rates**
   ```bash
   # Production: 10% sampling
   JAEGER_SAMPLING_RATE=0.1
   
   # Development: 100% sampling
   JAEGER_SAMPLING_RATE=1.0
   ```

2. **Optimize Log Levels**
   ```bash
   # Production: INFO level
   LOG_LEVEL=info
   
   # Development: DEBUG level
   LOG_LEVEL=debug
   ```

3. **Configure Metrics Collection**
   ```bash
   # Collect metrics every 15 seconds
   PROMETHEUS_DEFAULT_METRICS_INTERVAL=15000
   ```

4. **Tune Elasticsearch**
   ```bash
   # Reduce memory usage
   ES_JAVA_OPTS=-Xms512m -Xmx512m
   ```

## 8. Troubleshooting

### Common Issues

#### Jaeger Not Receiving Traces

1. Check Jaeger endpoint configuration
2. Verify sampling rate settings
3. Check network connectivity
4. Review application logs for tracing errors

#### Prometheus Not Scraping Metrics

1. Verify metrics endpoint is accessible
2. Check Prometheus configuration
3. Review scrape interval settings
4. Ensure application is exposing metrics

#### Elasticsearch Not Receiving Logs

1. Check Elasticsearch connection
2. Verify index mapping
3. Review Logstash configuration
4. Check log format and structure

#### Alerts Not Firing

1. Verify alert rule syntax
2. Check metric availability
3. Review AlertManager configuration
4. Test alert evaluation

### Health Checks

All monitoring components include health checks:

```bash
# Application health
curl http://localhost:3000/health

# Prometheus health
curl http://localhost:9091/-/healthy

# Elasticsearch health
curl http://localhost:9200/_cluster/health

# Jaeger health
curl http://localhost:14269/health
```

## 9. Security Considerations

### Network Security

- All monitoring services run in isolated Docker networks
- External access requires explicit port mapping
- Consider using reverse proxy for production

### Authentication

- Grafana: Configure LDAP/OAuth integration
- Kibana: Configure Elasticsearch security
- Prometheus: Use basic auth or OAuth proxy

### Data Protection

- Sensitive data is automatically filtered from logs
- PII is excluded from traces and metrics
- Configure data retention policies

## 10. Best Practices

### Development

1. **Use structured logging** with context
2. **Add custom metrics** for business KPIs
3. **Instrument critical paths** with custom spans
4. **Test alert rules** in staging environment

### Production

1. **Monitor the monitoring stack** itself
2. **Set up backup alerting channels**
3. **Implement log rotation** and retention policies
4. **Regularly review and update** dashboards and alerts

### Performance

1. **Use sampling** for high-traffic scenarios
2. **Batch metric updates** when possible
3. **Optimize log levels** for production
4. **Monitor resource usage** of monitoring components

This comprehensive monitoring and observability stack provides complete visibility into the application's performance, reliability, and business metrics, enabling proactive issue detection and resolution.
