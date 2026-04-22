import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StructuredLoggerService } from '../logging/structured-logger.service';

@Injectable()
export class SecretsService implements OnModuleInit {
  private secrets: Record<string, string> = {};
  private lastFetchTime: number = 0;
  private readonly ttl: number;
  private readonly isEnabled: boolean;

  constructor(
    private configService: ConfigService,
    private logger: StructuredLoggerService
  ) {
    this.ttl = this.configService.get<number>('vault.ttl', 300) * 1000;
    this.isEnabled = this.configService.get<boolean>('vault.enabled', false);
  }

  async onModuleInit() {
    if (this.isEnabled) {
      await this.refreshSecrets();
      this.startRotationCheck();
    } else {
      this.logger.info('Vault is disabled, using environment variables for secrets');
      this.loadFromEnv();
    }
  }

  private loadFromEnv() {
    this.secrets = {
      DATABASE_URL: this.configService.get('DATABASE_URL'),
      OPENAI_API_KEY: this.configService.get('OPENAI_API_KEY'),
      GROK_API_KEY: this.configService.get('GROK_API_KEY'),
      JWT_SECRET: this.configService.get('JWT_SECRET'),
      STELLAR_PRIVATE_KEY: this.configService.get('STELLAR_PRIVATE_KEY'),
      OAUTH_CLIENT_SECRET: this.configService.get('OAUTH_CLIENT_SECRET'),
    };
  }

  async getSecret(key: string): Promise<string | undefined> {
    if (this.isEnabled && Date.now() - this.lastFetchTime > this.ttl) {
      await this.refreshSecrets();
    }
    
    this.logger.info(`Accessing secret: ${key}`);
    return this.secrets[key];
  }

  private async refreshSecrets() {
    try {
      this.logger.info('Refreshing secrets from Vault...');
      // MOCK VAULT FETCH
      // In production, this would use node-vault or similar
      const vaultUrl = this.configService.get('vault.url');
      const secretsPath = this.configService.get('vault.secretsPath');
      
      // Simulating vault response
      const mockSecrets = {
        DATABASE_URL: 'postgresql://user:pass@vault-host:5432/db',
        OPENAI_API_KEY: 'sk-vault-key',
        GROK_API_KEY: 'grok-vault-key',
        JWT_SECRET: 'jwt-vault-secret',
        STELLAR_PRIVATE_KEY: 'S-VAULT-PRIVATE-KEY',
        OAUTH_CLIENT_SECRET: 'oauth-vault-secret',
      };

      this.secrets = { ...this.secrets, ...mockSecrets };
      this.lastFetchTime = Date.now();
      this.logger.info('Successfully refreshed secrets from Vault');
    } catch (error) {
      this.logger.error('Failed to refresh secrets from Vault', error);
      if (Object.keys(this.secrets).length === 0) {
        this.loadFromEnv();
      }
    }
  }

  private startRotationCheck() {
    const interval = this.configService.get<number>('vault.rotationCheckInterval', 30000);
    setInterval(async () => {
      await this.refreshSecrets();
    }, interval);
  }
}
