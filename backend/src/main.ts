import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RateLimitGuard } from './rate-limiting/guards/rate-limit.guard';
import { SystemLoadMiddleware } from './rate-limiting/middleware/system-load.middleware';
import { TracingInterceptor } from './tracing/interceptors/tracing.interceptor';
import { TracingMiddleware } from './tracing/middleware/tracing.middleware';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { StartupService } from './startup/services/startup.service';
import { MiddlewarePipeline } from './middleware-pipeline/pipeline';
import { wrap } from './middleware-pipeline/adapters/express-wrapper';
import { LoggingMiddleware } from './middleware-pipeline/middlewares/logging.middleware';
import { AuthenticationMiddleware } from './middleware-pipeline/middlewares/authentication.middleware';
import { ValidationMiddleware } from './middleware-pipeline/middlewares/validation.middleware';
import { ErrorHandlingMiddleware } from './middleware-pipeline/middlewares/error-handling.middleware';
import { RateLimitMiddleware } from './middleware-pipeline/middlewares/rate-limit.middleware';
import { CorsMiddleware } from './middleware-pipeline/middlewares/cors.middleware';
import { ResponseTransformInterceptor } from './middleware-pipeline/interceptors/response-transform.interceptor';
import { CorrelationIdMiddleware } from './logging/middleware/correlation-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const startupService = app.get(StartupService);

  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Note: CORS, cookie-parser, and helmet are registered via the middleware pipeline below

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  // Apply tracing interceptor globally
  const tracingInterceptor = app.get(TracingInterceptor);
  const responseTransform = app.get(ResponseTransformInterceptor);
  app.useGlobalInterceptors(tracingInterceptor, responseTransform);

  // Apply rate limiting guard globally
  const rateLimitGuard = app.get(RateLimitGuard);
  app.useGlobalGuards(rateLimitGuard);

  const tracingMiddleware = app.get(TracingMiddleware);
  const systemLoadMiddleware = app.get(SystemLoadMiddleware);
  const pipeline = app.get(MiddlewarePipeline);
  const logging = app.get(LoggingMiddleware);
  const auth = app.get(AuthenticationMiddleware);
  const validation = app.get(ValidationMiddleware);
  const rateLimit = app.get(RateLimitMiddleware);
  const cors = app.get(CorsMiddleware);
  const errorHandler = app.get(ErrorHandlingMiddleware);
  rateLimit.configure({ block: false });
  const correlationId = app.get(CorrelationIdMiddleware);
  pipeline
    .register(correlationId)
    .register(wrap('cookieParser', cookieParser()))
    .register(wrap('helmet', helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })))
    .register(cors)
    .register(logging)
    .register(wrap('TracingMiddleware', tracingMiddleware.use.bind(tracingMiddleware)))
    .useWhen((req) => req.path.startsWith('/auth') || !!req.headers.authorization, auth)
    .register(validation)
    .register(rateLimit)
    .register(wrap('SystemLoadMiddleware', systemLoadMiddleware.use.bind(systemLoadMiddleware)))
    .register(errorHandler);
  app.use(pipeline.build());

  // Enable graceful shutdown
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  
  // Wait for startup service to complete before listening
  console.log('🔄 Waiting for startup sequence to complete...');
  
  // Check if startup is complete before starting the server
  const maxWaitTime = 60000; // 60 seconds max wait time
  const checkInterval = 1000; // Check every second
  let waitTime = 0;

  while (!startupService.isReady() && waitTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    waitTime += checkInterval;
  }

  if (!startupService.isReady()) {
    console.error('❌ Startup sequence failed to complete within timeout');
    process.exit(1);
  }

  await app.listen(port);
  
  console.log(`🚀 ChenAIKit Backend running on port ${port}`);
  console.log(`📡 Submitter service running on http://localhost:${port}`);
  console.log(`🛡️  Rate limiting enabled with adaptive strategies`);
  console.log(`🔍 Distributed tracing enabled - Jaeger UI: http://localhost:16686`);
  console.log(`🏥 Health endpoints available:`);
  console.log(`   - Startup: http://localhost:${port}/health/startup`);
  console.log(`   - Readiness: http://localhost:${port}/health/readiness`);
  console.log(`   - Liveness: http://localhost:${port}/health/liveness`);
  console.log(`   - Full Health: http://localhost:${port}/health`);
  
  // Log startup report
  const report = startupService.getStartupReport();
  if (report) {
    console.log(`✅ Startup completed in ${report.totalDuration}ms`);
    console.log(`📊 Startup phases: ${report.phases.map(p => `${p.phase}(${p.duration}ms)`).join(', ')}`);
  }
}

bootstrap().catch(error => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
