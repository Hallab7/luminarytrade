import { registerAs } from '@nestjs/config';

export default registerAs('vault', () => ({
  enabled: process.env.VAULT_ENABLED === 'true',
  url: process.env.VAULT_ADDR || 'http://127.0.0.1:8200',
  token: process.env.VAULT_TOKEN,
  roleId: process.env.VAULT_ROLE_ID,
  secretId: process.env.VAULT_SECRET_ID,
  mountPath: process.env.VAULT_MOUNT_PATH || 'secret',
  secretsPath: process.env.VAULT_SECRETS_PATH || 'luminarytrade/production',
  ttl: parseInt(process.env.VAULT_CACHE_TTL || '300', 10), // 5 minutes
  rotationCheckInterval: parseInt(process.env.VAULT_ROTATION_CHECK_MS || '30000', 10), // 30 seconds
}));
