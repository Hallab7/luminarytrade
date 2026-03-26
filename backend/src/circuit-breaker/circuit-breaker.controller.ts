import { 
  Controller, 
  Get, 
  Post, 
  Delete, 
  Put, 
  Param, 
  Query, 
  HttpCode, 
  HttpStatus,
  Res,
  Body,
} from '@nestjs/common';
import { Response } from 'express';
import { CircuitBreakerManagerService } from './circuit-breaker-manager.service';
import { CircuitState } from './circuit-breaker.service';

@Controller('circuit-breaker')
export class CircuitBreakerController {
  constructor(
    private readonly circuitBreakerManager: CircuitBreakerManagerService,
  ) {}

  /**
   * Get health status of all circuit breakers
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  getHealth(@Res() res: Response) {
    try {
      const healthStatus = this.circuitBreakerManager.getHealthStatus();
      const globalStats = this.circuitBreakerManager.getGlobalStats();
      
      res.status(HttpStatus.OK).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        summary: {
          total: globalStats.totalCircuits,
          healthy: globalStats.healthyCircuits,
          unhealthy: globalStats.unhealthyCircuits,
          overallHealth: globalStats.healthyCircuits === globalStats.totalCircuits,
        },
        circuits: healthStatus,
        globalStats,
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get health status of specific circuit breaker
   */
  @Get('health/:name')
  @HttpCode(HttpStatus.OK)
  getCircuitHealth(
    @Param('name') name: string,
    @Res() res: Response,
  ) {
    try {
      const circuitBreaker = this.circuitBreakerManager.getCircuitBreakerByName(name);
      
      if (!circuitBreaker) {
        return res.status(HttpStatus.NOT_FOUND).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: `Circuit breaker '${name}' not found`,
        });
      }
      
      const stats = circuitBreaker.getStats();
      const healthStatus = this.circuitBreakerManager.getHealthStatus()
        .find(h => h.name === name);
      
      const statusCode = healthStatus?.healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
      
      res.status(statusCode).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        circuit: {
          name,
          state: stats.state,
          healthy: healthStatus?.healthy || false,
          stats,
          issues: healthStatus?.issues || [],
        },
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get global statistics
   */
  @Get('stats')
  @HttpCode(HttpStatus.OK)
  getGlobalStats(@Res() res: Response) {
    try {
      const stats = this.circuitBreakerManager.getGlobalStats();
      
      res.status(HttpStatus.OK).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        stats,
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get statistics of specific circuit breaker
   */
  @Get('stats/:name')
  @HttpCode(HttpStatus.OK)
  getCircuitStats(
    @Param('name') name: string,
    @Res() res: Response,
  ) {
    try {
      const circuitBreaker = this.circuitBreakerManager.getCircuitBreakerByName(name);
      
      if (!circuitBreaker) {
        return res.status(HttpStatus.NOT_FOUND).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: `Circuit breaker '${name}' not found`,
        });
      }
      
      const stats = circuitBreaker.getStats();
      
      res.status(HttpStatus.OK).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        circuit: {
          name,
          config: circuitBreaker.getConfig(),
          stats,
        },
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get all circuit breakers
   */
  @Get('circuits')
  @HttpCode(HttpStatus.OK)
  getAllCircuits(@Res() res: Response) {
    try {
      const circuitBreakers = this.circuitBreakerManager.getAllCircuitBreakers();
      const circuits = Array.from(circuitBreakers.entries()).map(([name, breaker]) => ({
        name,
        state: breaker.getState(),
        config: breaker.getConfig(),
        stats: breaker.getStats(),
      }));
      
      res.status(HttpStatus.OK).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        total: circuits.length,
        circuits,
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get historical metrics
   */
  @Get('metrics/history')
  @HttpCode(HttpStatus.OK)
  getHistoricalMetrics(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: number,
    @Res() res: Response,
  ) {
    try {
      let historicalData = this.circuitBreakerManager.getHistoricalData();
      
      // Filter by date range if provided
      if (from || to) {
        const fromDate = from ? new Date(from) : new Date(0);
        const toDate = to ? new Date(to) : new Date();
        
        historicalData = historicalData.filter(data => 
          data.timestamp >= fromDate && data.timestamp <= toDate
        );
      }
      
      // Apply limit
      if (limit && limit > 0) {
        historicalData = historicalData.slice(-limit);
      }
      
      res.status(HttpStatus.OK).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        filters: { from, to, limit },
        total: historicalData.length,
        data: historicalData,
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Export metrics
   */
  @Get('metrics/export')
  @HttpCode(HttpStatus.OK)
  exportMetrics(@Res() res: Response) {
    try {
      const exportData = this.circuitBreakerManager.exportMetrics();
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="circuit-breaker-metrics-${new Date().toISOString()}.json"`);
      
      res.status(HttpStatus.OK).send(exportData);
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Reset specific circuit breaker
   */
  @Post('reset/:name')
  @HttpCode(HttpStatus.OK)
  resetCircuit(
    @Param('name') name: string,
    @Res() res: Response,
  ) {
    try {
      const circuitBreaker = this.circuitBreakerManager.getCircuitBreakerByName(name);
      
      if (!circuitBreaker) {
        return res.status(HttpStatus.NOT_FOUND).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: `Circuit breaker '${name}' not found`,
        });
      }
      
      circuitBreaker.reset();
      
      res.status(HttpStatus.OK).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        message: `Circuit breaker '${name}' reset successfully`,
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Reset all circuit breakers
   */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  resetAllCircuits(@Res() res: Response) {
    try {
      this.circuitBreakerManager.resetAll();
      
      res.status(HttpStatus.OK).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        message: 'All circuit breakers reset successfully',
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Force open specific circuit breaker
   */
  @Post('open/:name')
  @HttpCode(HttpStatus.OK)
  openCircuit(
    @Param('name') name: string,
    @Res() res: Response,
  ) {
    try {
      const circuitBreaker = this.circuitBreakerManager.getCircuitBreakerByName(name);
      
      if (!circuitBreaker) {
        return res.status(HttpStatus.NOT_FOUND).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: `Circuit breaker '${name}' not found`,
        });
      }
      
      circuitBreaker.forceOpen();
      
      res.status(HttpStatus.OK).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        message: `Circuit breaker '${name}' forced open`,
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Force close specific circuit breaker
   */
  @Post('close/:name')
  @HttpCode(HttpStatus.OK)
  closeCircuit(
    @Param('name') name: string,
    @Res() res: Response,
  ) {
    try {
      const circuitBreaker = this.circuitBreakerManager.getCircuitBreakerByName(name);
      
      if (!circuitBreaker) {
        return res.status(HttpStatus.NOT_FOUND).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: `Circuit breaker '${name}' not found`,
        });
      }
      
      circuitBreaker.forceClose();
      
      res.status(HttpStatus.OK).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        message: `Circuit breaker '${name}' forced closed`,
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Create or update circuit breaker configuration
   */
  @Put('config/:name')
  @HttpCode(HttpStatus.OK)
  updateCircuitConfig(
    @Param('name') name: string,
    @Body() body: {
      failureThreshold?: number;
      resetTimeout?: number;
      monitoringPeriod?: number;
      timeout?: number;
      retryCount?: number;
      retryDelay?: number;
      retryBackoffMultiplier?: number;
    },
    @Res() res: Response,
  ) {
    try {
      let circuitBreaker = this.circuitBreakerManager.getCircuitBreakerByName(name);
      
      if (!circuitBreaker) {
        // Create new circuit breaker if it doesn't exist
        circuitBreaker = this.circuitBreakerManager.getCircuitBreaker(name, body);
      } else {
        // Update existing circuit breaker
        circuitBreaker.updateConfig(body);
      }
      
      res.status(HttpStatus.OK).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        message: `Circuit breaker '${name}' configuration updated`,
        config: circuitBreaker.getConfig(),
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get circuit breaker configuration
   */
  @Get('config/:name')
  @HttpCode(HttpStatus.OK)
  getCircuitConfig(
    @Param('name') name: string,
    @Res() res: Response,
  ) {
    try {
      const circuitBreaker = this.circuitBreakerManager.getCircuitBreakerByName(name);
      
      if (!circuitBreaker) {
        return res.status(HttpStatus.NOT_FOUND).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: `Circuit breaker '${name}' not found`,
        });
      }
      
      res.status(HttpStatus.OK).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        circuit: {
          name,
          config: circuitBreaker.getConfig(),
          state: circuitBreaker.getState(),
        },
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Test circuit breaker
   */
  @Post('test/:name')
  @HttpCode(HttpStatus.OK)
  testCircuit(
    @Param('name') name: string,
    @Body() body: {
      testFunction?: string; // Function name to test
      testUrl?: string; // URL to test
      timeout?: number;
    },
    @Res() res: Response,
  ) {
    try {
      const circuitBreaker = this.circuitBreakerManager.getCircuitBreakerByName(name);
      
      if (!circuitBreaker) {
        return res.status(HttpStatus.NOT_FOUND).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: `Circuit breaker '${name}' not found`,
        });
      }
      
      const startTime = Date.now();
      
      // Simple test function
      const testFunction = async () => {
        if (body.testUrl) {
          // Would implement HTTP test here
          await new Promise(resolve => setTimeout(resolve, 100));
          return { status: 'ok', url: body.testUrl };
        } else {
          // Default test
          await new Promise(resolve => setTimeout(resolve, 50));
          return { status: 'ok', message: 'Test completed successfully' };
        }
      };
      
      circuitBreaker.execute(testFunction)
        .then(result => {
          const duration = Date.now() - startTime;
          
          res.status(HttpStatus.OK).json({
            status: 'success',
            timestamp: new Date().toISOString(),
            test: {
              name,
              duration,
              result,
              circuitState: circuitBreaker.getState(),
            },
          });
        })
        .catch(error => {
          const duration = Date.now() - startTime;
          
          res.status(HttpStatus.OK).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            test: {
              name,
              duration,
              error: error instanceof Error ? error.message : String(error),
              circuitState: circuitBreaker.getState(),
            },
          });
        });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
