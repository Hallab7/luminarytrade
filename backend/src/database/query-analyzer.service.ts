import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner, SelectQueryBuilder } from 'typeorm';
import { AppConfigService } from '../config/app-config.service';
import { PrometheusService } from '../metrics/prometheus.service';
import { ELKLoggerService } from '../logging/elk-logger.service';

export interface QueryAnalysis {
  query: string;
  normalizedQuery: string;
  executionTime: number;
  timestamp: Date;
  parameters?: any[];
  rowCount?: number;
  indexUsage?: string;
  queryType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE' | 'DROP' | 'ALTER';
  tables: string[];
  columns: string[];
  isSlow: boolean;
  isN1: boolean;
  suggestions: string[];
  explainPlan?: QueryPlan;
}

export interface QueryPlan {
  planType: 'Seq Scan' | 'Index Scan' | 'Index Only Scan' | 'Bitmap Scan' | 'Hash Join' | 'Nested Loop' | 'Merge Join';
  relation?: string;
  alias?: string;
  cost: number;
  actualTime?: number;
  rows?: number;
  width?: number;
  condition?: string;
  indexName?: string;
  childPlans?: QueryPlan[];
}

export interface SlowQuery {
  query: string;
  executionTime: number;
  timestamp: Date;
  parameters?: any[];
  rowCount?: number;
  suggestions: string[];
}

export interface QueryStats {
  totalQueries: number;
  averageExecutionTime: number;
  slowQueriesCount: number;
  n1QueriesCount: number;
  topQueriesByTime: QueryAnalysis[];
  topQueriesByFrequency: QueryAnalysis[];
  indexUsageStats: Record<string, { usage: number; totalQueries: number }>;
}

@Injectable()
export class QueryAnalyzerService implements OnModuleInit, OnModuleDestroy {
  private slowQueries: SlowQuery[] = [];
  private queryStats: Map<string, QueryAnalysis[]> = new Map();
  private analysisInterval: NodeJS.Timeout;
  private readonly MAX_SLOW_QUERIES = 1000;
  private readonly ANALYSIS_INTERVAL = 60000; // 1 minute

  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
    private configService: ConfigService,
    private appConfig: AppConfigService,
    private prometheus: PrometheusService,
    private logger: ELKLoggerService
  ) {}

  async onModuleInit() {
    // Start periodic analysis
    this.analysisInterval = setInterval(() => {
      this.performPeriodicAnalysis();
    }, this.ANALYSIS_INTERVAL);

    this.logger.info('Query analyzer service initialized', undefined, {
      slowQueryThreshold: this.appConfig.database.slowQueryThreshold,
      analysisInterval: this.ANALYSIS_INTERVAL,
    });
  }

  async onModuleDestroy() {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
    }
  }

  /**
   * Analyze a query execution
   */
  async analyzeQuery(
    query: string,
    executionTime: number,
    parameters?: any[],
    rowCount?: number
  ): Promise<QueryAnalysis> {
    const normalizedQuery = this.normalizeQuery(query);
    const queryType = this.extractQueryType(query);
    const tables = this.extractTables(query);
    const columns = this.extractColumns(query);
    const isSlow = executionTime > this.appConfig.database.slowQueryThreshold;
    const isN1 = this.detectN1Query(query, tables);

    let explainPlan: QueryPlan | undefined;
    let suggestions: string[] = [];

    if (this.appConfig.database.enableExplainAnalyze) {
      try {
        explainPlan = await this.getExplainPlan(query, parameters);
        suggestions = this.generateSuggestions(query, explainPlan, executionTime, isN1);
      } catch (error) {
        this.logger.warn('Failed to get explain plan', undefined, {
          query: normalizedQuery,
          error: error.message,
        });
      }
    }

    const analysis: QueryAnalysis = {
      query,
      normalizedQuery,
      executionTime,
      timestamp: new Date(),
      parameters,
      rowCount,
      indexUsage: explainPlan?.planType,
      queryType,
      tables,
      columns,
      isSlow,
      isN1,
      suggestions,
      explainPlan,
    };

    // Store analysis
    this.storeAnalysis(analysis);

    // Record metrics
    this.recordQueryMetrics(analysis);

    // Log slow queries
    if (isSlow) {
      this.logSlowQuery(analysis);
    }

    // Log N+1 queries
    if (isN1) {
      this.logN1Query(analysis);
    }

    return analysis;
  }

  /**
   * Get slow queries from the last hour
   */
  getSlowQueries(hours: number = 1): SlowQuery[] {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.slowQueries.filter(q => q.timestamp >= cutoffTime);
  }

  /**
   * Get comprehensive query statistics
   */
  async getQueryStats(): Promise<QueryStats> {
    const allQueries = Array.from(this.queryStats.values()).flat();
    const totalQueries = allQueries.length;
    
    if (totalQueries === 0) {
      return {
        totalQueries: 0,
        averageExecutionTime: 0,
        slowQueriesCount: 0,
        n1QueriesCount: 0,
        topQueriesByTime: [],
        topQueriesByFrequency: [],
        indexUsageStats: {},
      };
    }

    const averageExecutionTime = allQueries.reduce((sum, q) => sum + q.executionTime, 0) / totalQueries;
    const slowQueriesCount = allQueries.filter(q => q.isSlow).length;
    const n1QueriesCount = allQueries.filter(q => q.isN1).length;

    // Top queries by execution time
    const topQueriesByTime = allQueries
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, 10);

    // Top queries by frequency
    const queryFrequency = new Map<string, number>();
    allQueries.forEach(q => {
      const count = queryFrequency.get(q.normalizedQuery) || 0;
      queryFrequency.set(q.normalizedQuery, count + 1);
    });

    const topQueriesByFrequency = Array.from(queryFrequency.entries())
      .map(([query, frequency]) => {
        const analysis = allQueries.find(q => q.normalizedQuery === query);
        return { ...analysis!, frequency };
      })
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    // Index usage statistics
    const indexUsageStats: Record<string, { usage: number; totalQueries: number }> = {};
    allQueries.forEach(q => {
      if (q.indexUsage) {
        const stats = indexUsageStats[q.indexUsage] || { usage: 0, totalQueries: 0 };
        stats.usage++;
        stats.totalQueries++;
        indexUsageStats[q.indexUsage] = stats;
      }
    });

    return {
      totalQueries,
      averageExecutionTime,
      slowQueriesCount,
      n1QueriesCount,
      topQueriesByTime,
      topQueriesByFrequency: topQueriesByFrequency as any,
      indexUsageStats,
    };
  }

  /**
   * Get database connection pool status
   */
  async getConnectionPoolStatus() {
    const pool = this.dataSource.driver['master']?.['pool'];
    
    if (!pool) {
      return {
        totalConnections: 0,
        activeConnections: 0,
        idleConnections: 0,
        queuedConnections: 0,
        maxConnections: this.appConfig.database.maxConnections,
        minConnections: this.appConfig.database.minConnections,
        utilization: 0,
      };
    }

    const totalConnections = pool.numUsed + pool.numFree;
    const activeConnections = pool.numUsed;
    const idleConnections = pool.numFree;
    const queuedConnections = pool.pendingRequests || 0;
    const utilization = (activeConnections / this.appConfig.database.maxConnections) * 100;

    return {
      totalConnections,
      activeConnections,
      idleConnections,
      queuedConnections,
      maxConnections: this.appConfig.database.maxConnections,
      minConnections: this.appConfig.database.minConnections,
      utilization: Math.round(utilization * 100) / 100,
    };
  }

  /**
   * Suggest indexes for frequently queried columns
   */
  async suggestIndexes(): Promise<Array<{ table: string; columns: string[]; reason: string; estimatedImpact: string }>> {
    const allQueries = Array.from(this.queryStats.values()).flat();
    const indexSuggestions = new Map<string, { columns: Set<string>; queries: string[]; reason: string }>();

    allQueries.forEach(query => {
      if (query.queryType === 'SELECT' && query.explainPlan?.planType === 'Seq Scan') {
        const key = query.tables[0];
        if (!key) return;

        const existing = indexSuggestions.get(key) || { columns: new Set(), queries: [], reason: 'Sequential scan detected' };
        
        // Extract WHERE clause columns
        const whereColumns = this.extractWhereColumns(query.query);
        whereColumns.forEach(col => existing.columns.add(col));
        
        existing.queries.push(query.normalizedQuery);
        indexSuggestions.set(key, existing);
      }
    });

    return Array.from(indexSuggestions.entries()).map(([table, suggestion]) => ({
      table,
      columns: Array.from(suggestion.columns),
      reason: suggestion.reason,
      estimatedImpact: this.estimateIndexImpact(suggestion.queries.length),
    }));
  }

  /**
   * Run EXPLAIN ANALYZE on a query
   */
  async getExplainPlan(query: string, parameters?: any[]): Promise<QueryPlan> {
    const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
    
    try {
      const result = await this.dataSource.query(explainQuery, parameters);
      const planData = result[0]['QUERY PLAN'][0];
      
      return this.parseExplainPlan(planData);
    } catch (error) {
      this.logger.error('Failed to execute EXPLAIN ANALYZE', error, undefined, {
        query,
        parameters,
      });
      throw error;
    }
  }

  /**
   * Normalize query for comparison
   */
  private normalizeQuery(query: string): string {
    return query
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ',')
      .replace(/\s*\(\s*/g, '(')
      .replace(/\s*\)\s*/g, ')')
      .replace(/\s*;\s*$/, '')
      .trim()
      .toLowerCase();
  }

  /**
   * Extract query type
   */
  private extractQueryType(query: string): QueryAnalysis['queryType'] {
    const normalized = query.trim().toLowerCase();
    
    if (normalized.startsWith('select')) return 'SELECT';
    if (normalized.startsWith('insert')) return 'INSERT';
    if (normalized.startsWith('update')) return 'UPDATE';
    if (normalized.startsWith('delete')) return 'DELETE';
    if (normalized.startsWith('create')) return 'CREATE';
    if (normalized.startsWith('drop')) return 'DROP';
    if (normalized.startsWith('alter')) return 'ALTER';
    
    return 'SELECT'; // Default
  }

  /**
   * Extract table names from query
   */
  private extractTables(query: string): string[] {
    const tables: string[] = [];
    const regex = /\b(?:from|join|into|update)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
    let match;
    
    while ((match = regex.exec(query)) !== null) {
      const table = match[1];
      if (!tables.includes(table)) {
        tables.push(table);
      }
    }
    
    return tables;
  }

  /**
   * Extract column names from query
   */
  private extractColumns(query: string): string[] {
    const columns: string[] = [];
    
    // Extract columns from SELECT clause
    const selectMatch = query.match(/select\s+(.+?)\s+from/i);
    if (selectMatch) {
      const selectClause = selectMatch[1];
      const columnList = selectClause.split(',').map(col => col.trim());
      
      columnList.forEach(col => {
        if (col !== '*' && !col.includes('(')) {
          const columnName = col.split('.').pop()?.split(' as ')[0]?.trim();
          if (columnName && !columns.includes(columnName)) {
            columns.push(columnName);
          }
        }
      });
    }
    
    return columns;
  }

  /**
   * Extract WHERE clause columns
   */
  private extractWhereColumns(query: string): string[] {
    const columns: string[] = [];
    const whereMatch = query.match(/where\s+(.+?)(?:\s+group\s+by|\s+order\s+by|\s+limit|\s+offset|$)/i);
    
    if (whereMatch) {
      const whereClause = whereMatch[1];
      const columnRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|!=|<>|>|<|>=|<=|like|in|is)/gi;
      let match;
      
      while ((match = columnRegex.exec(whereClause)) !== null) {
        const column = match[1];
        if (!columns.includes(column)) {
          columns.push(column);
        }
      }
    }
    
    return columns;
  }

  /**
   * Detect N+1 query pattern
   */
  private detectN1Query(query: string, tables: string[]): boolean {
    // Simple heuristic: if query accesses only one table and has a WHERE clause with ID
    if (tables.length === 1) {
      const hasIdWhere = /\bwhere\s+.*\b(?:id|_id)\s*[=]/i.test(query);
      return hasIdWhere;
    }
    return false;
  }

  /**
   * Parse EXPLAIN ANALYZE output
   */
  private parseExplainPlan(planData: any): QueryPlan {
    return {
      planType: planData['Node Type'],
      relation: planData['Relation Name'],
      alias: planData['Alias'],
      cost: planData['Total Cost'],
      actualTime: planData['Actual Total Time'],
      rows: planData['Actual Rows'],
      width: planData['Actual Loops'],
      condition: planData['Filter'],
      indexName: planData['Index Name'],
      childPlans: planData['Plans']?.map((p: any) => this.parseExplainPlan(p)) || [],
    };
  }

  /**
   * Generate optimization suggestions
   */
  private generateSuggestions(
    query: string,
    explainPlan: QueryPlan | undefined,
    executionTime: number,
    isN1: boolean
  ): string[] {
    const suggestions: string[] = [];

    // Slow query suggestions
    if (executionTime > this.appConfig.database.slowQueryThreshold) {
      suggestions.push(`Query is slow (${executionTime}ms). Consider optimization.`);
    }

    // Sequential scan suggestion
    if (explainPlan?.planType === 'Seq Scan') {
      suggestions.push('Sequential scan detected. Consider adding an index on filtered columns.');
    }

    // N+1 query suggestion
    if (isN1) {
      suggestions.push('Potential N+1 query detected. Consider using JOIN or batch loading.');
    }

    // SELECT * suggestion
    if (query.toLowerCase().includes('select *')) {
      suggestions.push('Avoid SELECT *. Specify only needed columns.');
    }

    // Missing WHERE clause
    if (!query.toLowerCase().includes('where') && query.toLowerCase().startsWith('select')) {
      suggestions.push('Consider adding WHERE clause to limit result set.');
    }

    // Large result set
    if (explainPlan?.rows && explainPlan.rows > 10000) {
      suggestions.push('Large result set detected. Consider pagination or filtering.');
    }

    return suggestions;
  }

  /**
   * Store query analysis
   */
  private storeAnalysis(analysis: QueryAnalysis) {
    const key = analysis.normalizedQuery;
    const existing = this.queryStats.get(key) || [];
    existing.push(analysis);
    
    // Keep only last 100 analyses per query
    if (existing.length > 100) {
      existing.shift();
    }
    
    this.queryStats.set(key, existing);

    // Store slow queries
    if (analysis.isSlow) {
      this.slowQueries.push({
        query: analysis.query,
        executionTime: analysis.executionTime,
        timestamp: analysis.timestamp,
        parameters: analysis.parameters,
        rowCount: analysis.rowCount,
        suggestions: analysis.suggestions,
      });

      // Keep only recent slow queries
      if (this.slowQueries.length > this.MAX_SLOW_QUERIES) {
        this.slowQueries.shift();
      }
    }
  }

  /**
   * Record query metrics
   */
  private recordQueryMetrics(analysis: QueryAnalysis) {
    const labels = {
      query_type: analysis.queryType,
      is_slow: analysis.isSlow.toString(),
      is_n1: analysis.isN1.toString(),
      service: 'luminarytrade-backend',
    };

    this.prometheus.incrementDbQueries(labels);
    this.prometheus.observeDbQueryDuration(analysis.executionTime / 1000, labels);

    if (analysis.isSlow) {
      this.prometheus.incrementDbQueries({
        ...labels,
        category: 'slow',
      });
    }

    if (analysis.isN1) {
      this.prometheus.incrementDbQueries({
        ...labels,
        category: 'n1',
      });
    }
  }

  /**
   * Log slow query
   */
  private logSlowQuery(analysis: QueryAnalysis) {
    this.logger.warn('Slow query detected', undefined, {
      query: analysis.normalizedQuery,
      executionTime: analysis.executionTime,
      timestamp: analysis.timestamp,
      suggestions: analysis.suggestions,
      rowCount: analysis.rowCount,
    });
  }

  /**
   * Log N+1 query
   */
  private logN1Query(analysis: QueryAnalysis) {
    this.logger.warn('Potential N+1 query detected', undefined, {
      query: analysis.normalizedQuery,
      executionTime: analysis.executionTime,
      timestamp: analysis.timestamp,
      tables: analysis.tables,
    });
  }

  /**
   * Perform periodic analysis
   */
  private async performPeriodicAnalysis() {
    try {
      const stats = await this.getQueryStats();
      const poolStatus = await this.getConnectionPoolStatus();
      
      // Update connection pool metrics
      this.prometheus.setDbConnectionsActive(poolStatus.activeConnections, {
        database: 'postgres',
        service: 'luminarytrade-backend',
      });

      this.prometheus.setDbConnectionsIdle(poolStatus.idleConnections, {
        database: 'postgres',
        service: 'luminarytrade-backend',
      });

      // Log periodic statistics
      this.logger.info('Query analysis completed', undefined, {
        totalQueries: stats.totalQueries,
        averageExecutionTime: stats.averageExecutionTime,
        slowQueriesCount: stats.slowQueriesCount,
        n1QueriesCount: stats.n1QueriesCount,
        poolUtilization: poolStatus.utilization,
      });

    } catch (error) {
      this.logger.error('Failed to perform periodic analysis', error);
    }
  }

  /**
   * Estimate index impact
   */
  private estimateIndexImpact(queryCount: number): string {
    if (queryCount > 100) return 'High - frequently queried';
    if (queryCount > 50) return 'Medium - moderately queried';
    if (queryCount > 10) return 'Low - occasionally queried';
    return 'Minimal - rarely queried';
  }
}
