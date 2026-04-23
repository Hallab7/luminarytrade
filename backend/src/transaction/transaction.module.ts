import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionManager } from './transaction-manager.service';
import { TransactionMonitorService } from './transaction-monitor.service';
import { TransactionController } from './transaction.controller';
import { StellarBridgeService } from './stellar-bridge.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([])],
  providers: [TransactionManager, TransactionMonitorService, StellarBridgeService],
  exports: [TransactionManager, TransactionMonitorService, StellarBridgeService],
  controllers: [TransactionController],
})
export class TransactionModule {}
