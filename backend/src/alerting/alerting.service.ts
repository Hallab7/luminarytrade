import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrometheusService } from '../metrics/prometheus.service';
import { ELKLoggerService } from '../logging/elk-logger.service';

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  condition: AlertCondition;
  actions: AlertAction[];
  cooldown: number; // in seconds
  lastTriggered?: Date;
  evaluationInterval: number; // in seconds
}

export interface AlertCondition {
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
  duration: number; // in seconds
  labels?: Record<string, string>;
}

export interface AlertAction {
  type: 'log' | 'webhook' | 'email' | 'slack';
  config: Record<string, any>;
}

export interface AlertState {
  ruleId: string;
  active: boolean;
  triggeredAt?: Date;
  resolvedAt?: Date;
  lastEvaluation?: Date;
  currentValue?: number;
}

export interface AlertConfig {
  enabled: boolean;
  evaluationInterval: number;
  defaultActions: AlertAction[];
  rules: AlertRule[];
  webhook?: {
    timeout: number;
    retries: number;
  };
  email?: {
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      auth: {
        user: string;
        pass: string;
      };
    };
    from: string;
    to: string[];
  };
  slack?: {
    webhook: string;
    channel: string;
    username: string;
  };
}

@Injectable()
export class AlertingService implements OnModuleInit {
  private config: AlertConfig;
  private alertStates: Map<string, AlertState> = new Map();
  private evaluationInterval: NodeJS.Timeout;
  private activeEvaluations: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private configService: ConfigService,
    private prometheusService: PrometheusService,
    private logger: ELKLoggerService
  ) {}

  async onModuleInit() {
    this.config = this.getConfig();
    
    if (!this.config.enabled) {
      this.logger.info('Alerting service disabled');
      return;
    }

    // Initialize alert states
    this.config.rules.forEach(rule => {
      this.alertStates.set(rule.id, {
        ruleId: rule.id,
        active: false,
      });
    });

    // Start evaluation interval
    this.startEvaluation();

    this.logger.info('Alerting service initialized', undefined, {
      rulesCount: this.config.rules.length,
      evaluationInterval: this.config.evaluationInterval,
    });
  }

  private getConfig(): AlertConfig {
    return {
      enabled: this.configService.get('ALERTING_ENABLED', 'true') === 'true',
      evaluationInterval: parseInt(this.configService.get('ALERTING_EVALUATION_INTERVAL', '30')),
      defaultActions: [
        {
          type: 'log',
          config: { level: 'error' },
        },
      ],
      rules: this.getDefaultRules(),
      webhook: {
        timeout: parseInt(this.configService.get('ALERT_WEBHOOK_TIMEOUT', '10000')),
        retries: parseInt(this.configService.get('ALERT_WEBHOOK_RETRIES', '3')),
      },
      email: this.configService.get('ALERT_EMAIL_ENABLED') === 'true' ? {
        smtp: {
          host: this.configService.get('ALERT_EMAIL_SMTP_HOST', 'localhost'),
          port: parseInt(this.configService.get('ALERT_EMAIL_SMTP_PORT', '587')),
          secure: this.configService.get('ALERT_EMAIL_SMTP_SECURE', 'false') === 'true',
          auth: {
            user: this.configService.get('ALERT_EMAIL_USER'),
            pass: this.configService.get('ALERT_EMAIL_PASS'),
          },
        },
        from: this.configService.get('ALERT_EMAIL_FROM', 'alerts@luminarytrade.com'),
        to: this.configService.get('ALERT_EMAIL_TO', '').split(','),
      } : undefined,
      slack: this.configService.get('ALERT_SLACK_ENABLED') === 'true' ? {
        webhook: this.configService.get('ALERT_SLACK_WEBHOOK'),
        channel: this.configService.get('ALERT_SLACK_CHANNEL', '#alerts'),
        username: this.configService.get('ALERT_SLACK_USERNAME', 'LuminaryTrade Bot'),
      } : undefined,
    };
  }

  private getDefaultRules(): AlertRule[] {
    return [
      // Error rate alert
      {
        id: 'error-rate-high',
        name: 'High Error Rate',
        description: 'Error rate exceeds 5%',
        enabled: true,
        severity: 'critical',
        condition: {
          metric: 'http_requests_total',
          operator: '>',
          threshold: 0.05,
          duration: 300, // 5 minutes
          labels: { status_code: '5..' },
        },
        actions: [
          { type: 'log', config: { level: 'error' } },
          { type: 'webhook', config: { url: process.env.ALERT_WEBHOOK_URL } },
        ],
        cooldown: 900, // 15 minutes
        evaluationInterval: 60, // 1 minute
      },
      // P99 latency alert
      {
        id: 'p99-latency-high',
        name: 'High P99 Latency',
        description: 'P99 response time exceeds 2 seconds',
        enabled: true,
        severity: 'high',
        condition: {
          metric: 'http_request_duration_seconds',
          operator: '>',
          threshold: 2.0,
          duration: 300, // 5 minutes
          labels: { quantile: '0.99' },
        },
        actions: [
          { type: 'log', config: { level: 'warn' } },
          { type: 'webhook', config: { url: process.env.ALERT_WEBHOOK_URL } },
        ],
        cooldown: 600, // 10 minutes
        evaluationInterval: 60, // 1 minute
      },
      // Blockchain submission failures
      {
        id: 'blockchain-failures-high',
        name: 'High Blockchain Failure Rate',
        description: 'Blockchain submissions fail rate exceeds 10%',
        enabled: true,
        severity: 'high',
        condition: {
          metric: 'blockchain_submission_failures_total',
          operator: '>',
          threshold: 0.1,
          duration: 600, // 10 minutes
        },
        actions: [
          { type: 'log', config: { level: 'error' } },
          { type: 'webhook', config: { url: process.env.ALERT_WEBHOOK_URL } },
        ],
        cooldown: 1800, // 30 minutes
        evaluationInterval: 120, // 2 minutes
      },
      // Job queue depth alert
      {
        id: 'job-queue-depth-high',
        name: 'High Job Queue Depth',
        description: 'Job queue depth exceeds 1000 jobs',
        enabled: true,
        severity: 'medium',
        condition: {
          metric: 'job_queue_depth',
          operator: '>',
          threshold: 1000,
          duration: 300, // 5 minutes
        },
        actions: [
          { type: 'log', config: { level: 'warn' } },
        ],
        cooldown: 300, // 5 minutes
        evaluationInterval: 60, // 1 minute
      },
      // Database connection issues
      {
        id: 'db-connections-high',
        name: 'High Database Connections',
        description: 'Active database connections exceed threshold',
        enabled: true,
        severity: 'medium',
        condition: {
          metric: 'db_connections_active',
          operator: '>',
          threshold: 80,
          duration: 300, // 5 minutes
        },
        actions: [
          { type: 'log', config: { level: 'warn' } },
        ],
        cooldown: 600, // 10 minutes
        evaluationInterval: 60, // 1 minute
      },
      // Memory usage alert
      {
        id: 'memory-usage-high',
        name: 'High Memory Usage',
        description: 'Memory usage exceeds 80%',
        enabled: true,
        severity: 'high',
        condition: {
          metric: 'memory_usage_bytes',
          operator: '>',
          threshold: 0.8,
          duration: 300, // 5 minutes
          labels: { type: 'heap_used' },
        },
        actions: [
          { type: 'log', config: { level: 'warn' } },
        ],
        cooldown: 600, // 10 minutes
        evaluationInterval: 60, // 1 minute
      },
      // AI provider errors
      {
        id: 'ai-provider-errors-high',
        name: 'High AI Provider Error Rate',
        description: 'AI provider error rate exceeds 15%',
        enabled: true,
        severity: 'medium',
        condition: {
          metric: 'ai_provider_errors_total',
          operator: '>',
          threshold: 0.15,
          duration: 300, // 5 minutes
        },
        actions: [
          { type: 'log', config: { level: 'warn' } },
        ],
        cooldown: 600, // 10 minutes
        evaluationInterval: 120, // 2 minutes
      },
    ];
  }

  private startEvaluation() {
    this.evaluationInterval = setInterval(async () => {
      await this.evaluateAllRules();
    }, this.config.evaluationInterval * 1000);
  }

  private async evaluateAllRules() {
    for (const rule of this.config.rules) {
      if (!rule.enabled) continue;

      // Check if rule is in cooldown
      const state = this.alertStates.get(rule.id);
      if (state?.active && rule.lastTriggered && 
          Date.now() - rule.lastTriggered.getTime() < rule.cooldown * 1000) {
        continue;
      }

      await this.evaluateRule(rule);
    }
  }

  private async evaluateRule(rule: AlertRule) {
    try {
      const currentValue = await this.getMetricValue(rule.condition);
      const state = this.alertStates.get(rule.id)!;
      
      state.lastEvaluation = new Date();
      state.currentValue = currentValue;

      const isTriggered = this.evaluateCondition(rule.condition, currentValue);

      if (isTriggered && !state.active) {
        // Alert should fire
        state.active = true;
        state.triggeredAt = new Date();
        rule.lastTriggered = new Date();

        await this.triggerAlert(rule, currentValue);
      } else if (!isTriggered && state.active) {
        // Alert should resolve
        state.active = false;
        state.resolvedAt = new Date();

        await this.resolveAlert(rule, currentValue);
      }
    } catch (error) {
      this.logger.error('Failed to evaluate alert rule', error, undefined, {
        ruleId: rule.id,
        ruleName: rule.name,
      });
    }
  }

  private async getMetricValue(condition: AlertCondition): Promise<number> {
    // This is a simplified implementation
    // In a real scenario, you would query Prometheus API
    const metrics = await this.prometheusService.getMetrics();
    
    // Parse metrics to extract the value for the specific metric
    // This is a placeholder - actual implementation would use PromQL queries
    switch (condition.metric) {
      case 'http_requests_total':
        return this.calculateErrorRate(metrics, condition.labels);
      case 'http_request_duration_seconds':
        return this.getP99Latency(metrics);
      case 'blockchain_submission_failures_total':
        return this.getBlockchainFailureRate(metrics);
      case 'job_queue_depth':
        return this.getJobQueueDepth(metrics);
      case 'db_connections_active':
        return this.getDbConnections(metrics);
      case 'memory_usage_bytes':
        return this.getMemoryUsage(metrics);
      case 'ai_provider_errors_total':
        return this.getAIProviderErrorRate(metrics);
      default:
        return 0;
    }
  }

  private evaluateCondition(condition: AlertCondition, value: number): boolean {
    switch (condition.operator) {
      case '>': return value > condition.threshold;
      case '<': return value < condition.threshold;
      case '>=': return value >= condition.threshold;
      case '<=': return value <= condition.threshold;
      case '==': return value === condition.threshold;
      case '!=': return value !== condition.threshold;
      default: return false;
    }
  }

  private async triggerAlert(rule: AlertRule, value: number) {
    const alertData = {
      ruleId: rule.id,
      ruleName: rule.name,
      description: rule.description,
      severity: rule.severity,
      value,
      threshold: rule.condition.threshold,
      triggeredAt: new Date(),
    };

    this.logger.warn(`ALERT TRIGGERED: ${rule.name}`, undefined, alertData);

    // Execute alert actions
    for (const action of rule.actions) {
      await this.executeAction(action, alertData);
    }
  }

  private async resolveAlert(rule: AlertRule, value: number) {
    const alertData = {
      ruleId: rule.id,
      ruleName: rule.name,
      description: rule.description,
      severity: rule.severity,
      value,
      threshold: rule.condition.threshold,
      resolvedAt: new Date(),
    };

    this.logger.info(`ALERT RESOLVED: ${rule.name}`, undefined, alertData);
  }

  private async executeAction(action: AlertAction, alertData: any) {
    try {
      switch (action.type) {
        case 'log':
          this.executeLogAction(action, alertData);
          break;
        case 'webhook':
          await this.executeWebhookAction(action, alertData);
          break;
        case 'email':
          await this.executeEmailAction(action, alertData);
          break;
        case 'slack':
          await this.executeSlackAction(action, alertData);
          break;
      }
    } catch (error) {
      this.logger.error('Failed to execute alert action', error, undefined, {
        actionType: action.type,
        ruleId: alertData.ruleId,
      });
    }
  }

  private executeLogAction(action: AlertAction, alertData: any) {
    const level = action.config.level || 'error';
    this.logger[level](`ALERT: ${alertData.ruleName}`, undefined, alertData);
  }

  private async executeWebhookAction(action: AlertAction, alertData: any) {
    if (!action.config.url) return;

    const payload = {
      alert: alertData,
      timestamp: new Date().toISOString(),
      service: this.configService.get('SERVICE_NAME', 'luminarytrade-backend'),
    };

    // In a real implementation, you would use an HTTP client
    console.log(`WEBHOOK ALERT: ${JSON.stringify(payload)}`);
  }

  private async executeEmailAction(action: AlertAction, alertData: any) {
    if (!this.config.email) return;

    // In a real implementation, you would use an email service
    console.log(`EMAIL ALERT: ${alertData.ruleName} - ${alertData.description}`);
  }

  private async executeSlackAction(action: AlertAction, alertData: any) {
    if (!this.config.slack) return;

    const payload = {
      channel: this.config.slack.channel,
      username: this.config.slack.username,
      text: `🚨 ALERT: ${alertData.ruleName}`,
      attachments: [
        {
          color: this.getSeverityColor(alertData.severity),
          fields: [
            { title: 'Description', value: alertData.description, short: false },
            { title: 'Severity', value: alertData.severity.toUpperCase(), short: true },
            { title: 'Value', value: alertData.value.toString(), short: true },
            { title: 'Threshold', value: alertData.threshold.toString(), short: true },
          ],
          ts: Math.floor(new Date(alertData.triggeredAt).getTime() / 1000),
        },
      ],
    };

    console.log(`SLACK ALERT: ${JSON.stringify(payload)}`);
  }

  private getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical': return 'danger';
      case 'high': return 'warning';
      case 'medium': return 'good';
      case 'low': return '#36a64f';
      default: return 'good';
    }
  }

  // Placeholder metric calculation methods
  private calculateErrorRate(metrics: string, labels?: Record<string, string>): number {
    // Simplified calculation
    return Math.random() * 0.1; // 0-10%
  }

  private getP99Latency(metrics: string): number {
    return Math.random() * 3; // 0-3 seconds
  }

  private getBlockchainFailureRate(metrics: string): number {
    return Math.random() * 0.2; // 0-20%
  }

  private getJobQueueDepth(metrics: string): number {
    return Math.floor(Math.random() * 2000);
  }

  private getDbConnections(metrics: string): number {
    return Math.floor(Math.random() * 100);
  }

  private getMemoryUsage(metrics: string): number {
    return Math.random(); // 0-100%
  }

  private getAIProviderErrorRate(metrics: string): number {
    return Math.random() * 0.3; // 0-30%
  }

  // Public API methods
  getAlertStates(): Map<string, AlertState> {
    return new Map(this.alertStates);
  }

  getRules(): AlertRule[] {
    return this.config.rules;
  }

  async addRule(rule: AlertRule): Promise<void> {
    this.config.rules.push(rule);
    this.alertStates.set(rule.id, {
      ruleId: rule.id,
      active: false,
    });
  }

  async removeRule(ruleId: string): Promise<void> {
    this.config.rules = this.config.rules.filter(rule => rule.id !== ruleId);
    this.alertStates.delete(ruleId);
  }

  async updateRule(ruleId: string, updates: Partial<AlertRule>): Promise<void> {
    const ruleIndex = this.config.rules.findIndex(rule => rule.id === ruleId);
    if (ruleIndex !== -1) {
      this.config.rules[ruleIndex] = { ...this.config.rules[ruleIndex], ...updates };
    }
  }

  async testRule(ruleId: string): Promise<boolean> {
    const rule = this.config.rules.find(r => r.id === ruleId);
    if (!rule) return false;

    await this.evaluateRule(rule);
    return true;
  }
}
