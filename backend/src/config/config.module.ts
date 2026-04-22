import { Module, Global } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { SecretsService } from './secrets.service';
import vaultConfig from './vault.config';
import { LoggingModule } from '../logging/logging.module';

@Global()
@Module({
  imports: [
    NestConfigModule.forFeature(vaultConfig),
    LoggingModule,
  ],
  providers: [SecretsService],
  exports: [SecretsService],
})
export class ConfigModule {}
