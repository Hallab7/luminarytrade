import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MetricsInterceptor } from '../metrics/interceptors/metrics.interceptor';
import { LoggingInterceptor } from '../logging/interceptors/logging.interceptor';
import { QueryAnalyzerService, QueryStats } from './query-analyzer.service';

@ApiTags('Database Monitoring')
@Controller('db')
@UseGuards(JwtAuthGuard)
@UseInterceptors(MetricsInterceptor, LoggingInterceptor)
export class DatabaseMonitorController {
  constructor(private readonly queryAnalyzer: QueryAnalyzerService) {}

  @Get('connections')
  @ApiOperation({ summary: 'Get database connection pool status' })
  @ApiResponse({ status: 200, description: 'Connection pool status retrieved successfully' })
  async getConnectionPoolStatus() {
    return await this.queryAnalyzer.getConnectionPoolStatus();
  }

  @Get('slow-queries')
  @ApiOperation({ summary: 'Get slow queries from the last N hours' })
  @ApiQuery({ name: 'hours', required: false, type: Number, description: 'Number of hours to look back (default: 1)' })
  @ApiResponse({ status: 200, description: 'Slow queries retrieved successfully' })
  async getSlowQueries(@Query('hours') hours?: number) {
    const slowQueries = this.queryAnalyzer.getSlowQueries(hours || 1);
    
    return {
      count: slowQueries.length,
      timeRange: `${hours || 1} hour(s)`,
      queries: slowQueries.map(q => ({
        query: q.query.substring(0, 200) + (q.query.length > 200 ? '...' : ''),
        executionTime: q.executionTime,
        timestamp: q.timestamp,
        rowCount: q.rowCount,
        suggestions: q.suggestions,
      })),
    };
  }

  @Get('query-stats')
  @ApiOperation({ summary: 'Get comprehensive query statistics' })
  @ApiResponse({ status: 200, description: 'Query statistics retrieved successfully' })
  async getQueryStats(): Promise<QueryStats> {
    return await this.queryAnalyzer.getQueryStats();
  }

  @Get('index-suggestions')
  @ApiOperation({ summary: 'Get index suggestions for query optimization' })
  @ApiResponse({ status: 200, description: 'Index suggestions retrieved successfully' })
  async getIndexSuggestions() {
    return await this.queryAnalyzer.suggestIndexes();
  }

  @Get('health')
  @ApiOperation({ summary: 'Get database health status' })
  @ApiResponse({ status: 200, description: 'Database health status retrieved successfully' })
  async getDatabaseHealth() {
    const poolStatus = await this.queryAnalyzer.getConnectionPoolStatus();
    const stats = await this.queryAnalyzer.getQueryStats();
    
    const isHealthy = 
      poolStatus.utilization < 80 && // Pool utilization under 80%
      stats.averageExecutionTime < 1000 && // Average execution time under 1s
      stats.slowQueriesCount < stats.totalQueries * 0.05; // Slow queries under 5%

    return {
      healthy: isHealthy,
      poolStatus,
      queryStats: {
        totalQueries: stats.totalQueries,
        averageExecutionTime: stats.averageExecutionTime,
        slowQueriesCount: stats.slowQueriesCount,
        slowQueryRate: stats.totalQueries > 0 ? (stats.slowQueriesCount / stats.totalQueries) * 100 : 0,
      },
      recommendations: this.generateHealthRecommendations(poolStatus, stats),
    };
  }

  @Get('performance')
  @ApiOperation({ summary: 'Get detailed performance metrics' })
  @ApiResponse({ status: 200, description: 'Performance metrics retrieved successfully' })
  async getPerformanceMetrics() {
    const stats = await this.queryAnalyzer.getQueryStats();
    const poolStatus = await this.queryAnalyzer.getConnectionPoolStatus();
    
    return {
      connectionPool: {
        ...poolStatus,
        status: this.getPoolStatus(poolStatus.utilization),
      },
      queries: {
        total: stats.totalQueries,
        averageTime: stats.averageExecutionTime,
        slowQueries: stats.slowQueriesCount,
        n1Queries: stats.n1QueriesCount,
        topSlowQueries: stats.topQueriesByTime.slice(0, 5).map(q => ({
          query: q.query.substring(0, 100) + (q.query.length > 100 ? '...' : ''),
          executionTime: q.executionTime,
          timestamp: q.timestamp,
          suggestions: q.suggestions,
        })),
        topFrequentQueries: stats.topQueriesByFrequency.slice(0, 5).map(q => ({
          query: q.query.substring(0, 100) + (q.query.length > 100 ? '...' : ''),
          frequency: q.frequency,
          averageExecutionTime: q.executionTime,
        })),
      },
      indexUsage: stats.indexUsageStats,
      recommendations: this.getPerformanceRecommendations(poolStatus, stats),
    };
  }

  @Get('explain')
  @ApiOperation({ summary: 'Get EXPLAIN ANALYZE for a specific query' })
  @ApiQuery({ name: 'query', required: true, type: String, description: 'Query to analyze' })
  @ApiResponse({ status: 200, description: 'Query plan retrieved successfully' })
  async explainQuery(@Query('query') query: string) {
    try {
      const plan = await this.queryAnalyzer.getExplainPlan(query);
      return {
        query,
        plan,
        suggestions: this.generatePlanSuggestions(plan),
      };
    } catch (error) {
      return {
        query,
        error: error.message,
        suggestions: ['Check query syntax and permissions'],
      };
    }
  }

  private generateHealthRecommendations(poolStatus: any, stats: QueryStats): string[] {
    const recommendations: string[] = [];

    if (poolStatus.utilization > 80) {
      recommendations.push('Connection pool utilization is high. Consider increasing max connections.');
    }

    if (poolStatus.queuedConnections > 0) {
      recommendations.push('There are queued connections. Consider optimizing query performance or increasing pool size.');
    }

    if (stats.averageExecutionTime > 500) {
      recommendations.push('Average query execution time is high. Review slow queries and add indexes.');
    }

    if (stats.slowQueriesCount > stats.totalQueries * 0.05) {
      recommendations.push('Slow query rate is high. Implement query optimization and monitoring.');
    }

    if (stats.n1QueriesCount > 0) {
      recommendations.push('N+1 queries detected. Consider using JOIN or batch loading strategies.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Database performance is optimal.');
    }

    return recommendations;
  }

  private getPerformanceRecommendations(poolStatus: any, stats: QueryStats): string[] {
    const recommendations: string[] = [];

    // Connection pool recommendations
    if (poolStatus.utilization > 70) {
      recommendations.push('Monitor connection pool utilization closely');
    }
    if (poolStatus.utilization > 90) {
      recommendations.push('URGENT: Increase max connections or optimize queries');
    }

    // Query performance recommendations
    if (stats.averageExecutionTime > 200) {
      recommendations.push('Consider query optimization and indexing');
    }
    if (stats.averageExecutionTime > 1000) {
      recommendations.push('CRITICAL: Review and optimize slow queries immediately');
    }

    // Index usage recommendations
    const sequentialScanRate = this.calculateSequentialScanRate(stats);
    if (sequentialScanRate > 30) {
      recommendations.push('High sequential scan rate. Review missing indexes');
    }

    // N+1 query recommendations
    if (stats.n1QueriesCount > stats.totalQueries * 0.1) {
      recommendations.push('High N+1 query rate. Implement batch loading');
    }

    return recommendations;
  }

  private getPoolStatus(utilization: number): 'excellent' | 'good' | 'warning' | 'critical' {
    if (utilization < 50) return 'excellent';
    if (utilization < 70) return 'good';
    if (utilization < 85) return 'warning';
    return 'critical';
  }

  private calculateSequentialScanRate(stats: QueryStats): number {
    const totalScans = Object.values(stats.indexUsageStats).reduce((sum, stat) => sum + stat.totalQueries, 0);
    const sequentialScans = stats.indexUsageStats['Seq Scan']?.totalQueries || 0;
    
    return totalScans > 0 ? (sequentialScans / totalScans) * 100 : 0;
  }

  private generatePlanSuggestions(plan: any): string[] {
    const suggestions: string[] = [];

    if (plan.planType === 'Seq Scan') {
      suggestions.push('Consider adding an index on filtered columns');
    }

    if (plan.cost > 10000) {
      suggestions.push('Query cost is high. Consider optimization strategies');
    }

    if (plan.rows && plan.rows > 10000) {
      suggestions.push('Large result set. Consider adding LIMIT or filtering');
    }

    if (plan.actualTime && plan.actualTime > 1000) {
      suggestions.push('Query execution time is high. Review indexes and query structure');
    }

    if (plan.childPlans && plan.childPlans.length > 5) {
      suggestions.push('Complex query plan. Consider breaking into simpler queries');
    }

    return suggestions;
  }
}
