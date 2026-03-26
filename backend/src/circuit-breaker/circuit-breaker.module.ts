import { Module } from '@nestjs/common';

// Services
import { CircuitBreakerService } from './circuit-breaker.service';
import { CircuitBreakerManagerService } from './circuit-breaker-manager.service';

// Controllers
import { CircuitBreakerController } from './circuit-breaker.controller';

@Module({
  providers: [
    CircuitBreakerService,
    CircuitBreakerManagerService,
  ],
  controllers: [
    CircuitBreakerController,
  ],
  exports: [
    CircuitBreakerService,
    CircuitBreakerManagerService,
  ],
})
export class CircuitBreakerModule {}
