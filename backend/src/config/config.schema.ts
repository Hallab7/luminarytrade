import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum Environment {
    Development = 'development',
    Production = 'production',
    Test = 'test',
    Staging = 'staging',
}

export class DatabaseConfig {
    @IsString()
    @IsNotEmpty()
    host: string;

    @IsInt()
    @Min(0)
    @Max(65535)
    port: number;

    @IsString()
    @IsNotEmpty()
    user: string;

    @IsString()
    @IsNotEmpty()
    password: string;

    @IsString()
    @IsNotEmpty()
    name: string;

    // Connection Pool Configuration
    @IsInt()
    @Min(1)
    @Max(100)
    @IsOptional()
    minConnections: number = 10;

    @IsInt()
    @Min(1)
    @Max(200)
    @IsOptional()
    maxConnections: number = 50;

    @IsInt()
    @Min(1000)
    @Max(300000)
    @IsOptional()
    idleTimeoutMillis: number = 30000;

    @IsInt()
    @Min(1000)
    @Max(60000)
    @IsOptional()
    connectionTimeoutMillis: number = 10000;

    @IsInt()
    @Min(0)
    @Max(10)
    @IsOptional()
    acquireTimeoutMillis: number = 5000;

    @IsInt()
    @Min(1000)
    @Max(300000)
    @IsOptional()
    createTimeoutMillis: number = 30000;

    @IsInt()
    @Min(1000)
    @Max(60000)
    @IsOptional()
    destroyTimeoutMillis: number = 5000;

    @IsInt()
    @Min(0)
    @Max(100)
    @IsOptional()
    reapIntervalMillis: number = 1000;

    @IsInt()
    @Min(0)
    @Max(1000)
    @IsOptional()
    createRetryIntervalMillis: number = 200;

    @IsString()
    @IsOptional()
    validationQuery: string = 'SELECT 1';

    @IsBoolean()
    @IsOptional()
    enableSsl: boolean = false;

    @IsString()
    @IsOptional()
    sslMode: string = 'prefer';

    @IsString()
    @IsOptional()
    sslCert?: string;

    @IsString()
    @IsOptional()
    sslKey?: string;

    @IsString()
    @IsOptional()
    sslCA?: string;

    // Query Optimization Configuration
    @IsBoolean()
    @IsOptional()
    enableQueryLogging: boolean = true;

    @IsInt()
    @Min(100)
    @Max(10000)
    @IsOptional()
    slowQueryThreshold: number = 1000;

    @IsBoolean()
    @IsOptional()
    enableExplainAnalyze: boolean = true;

    @IsBoolean()
    @IsOptional()
    enableQueryCache: boolean = true;

    @IsInt()
    @Min(1000)
    @Max(60000)
    @IsOptional()
    queryCacheTimeout: number = 5000;

    @IsBoolean()
    @IsOptional()
    enableStatementTimeout: boolean = true;

    @IsInt()
    @Min(1000)
    @Max(300000)
    @IsOptional()
    statementTimeout: number = 30000;
}

export class RedisConfig {
    @IsString()
    @IsNotEmpty()
    host: string;

    @IsInt()
    @Min(0)
    @Max(65535)
    port: number;

    @IsString()
    @IsOptional()
    password?: string;
}

export class StellarConfig {
    @IsString()
    @IsOptional()
    network: string = 'testnet';

    @IsString()
    @IsOptional()
    secretKey?: string;
}

export class AIConfig {
    @IsString()
    @IsOptional()
    openaiApiKey?: string;

    @IsString()
    @IsOptional()
    anthropicApiKey?: string;

    @IsString()
    @IsOptional()
    model: string = 'gpt-4';
}

export class SecurityConfig {
    @IsString()
    @IsNotEmpty()
    jwtSecret: string;

    @IsString()
    @IsOptional()
    corsOrigin: string = '*';
}

export class AppConfig {
    @IsEnum(Environment)
    nodeEnv: Environment = Environment.Development;

    @IsInt()
    @Min(0)
    @Max(65535)
    port: number = 3000;

    @ValidateNested()
    @Type(() => DatabaseConfig)
    database: DatabaseConfig;

    @ValidateNested()
    @Type(() => RedisConfig)
    redis: RedisConfig;

    @ValidateNested()
    @Type(() => StellarConfig)
    stellar: StellarConfig;

    @ValidateNested()
    @Type(() => AIConfig)
    ai: AIConfig;

    @ValidateNested()
    @Type(() => SecurityConfig)
    security: SecurityConfig;
}
