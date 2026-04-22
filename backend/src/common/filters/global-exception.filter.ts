import { Catch, ArgumentsHost, HttpException, Optional } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppException } from '../exceptions/app.exception';
import { BaseExceptionFilter } from '@nestjs/core';
import { I18nService } from '../../i18n/i18n.service';
import { I18nContext } from 'nestjs-i18n';

@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
  constructor(
    @Optional() private readonly i18n?: I18nService,
  ) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

    // Resolve language: from nestjs-i18n context, or Accept-Language header,
    // or fall back to English.
    const lang =
      I18nContext.current(host as any)?.lang ??
      this.parseAcceptLanguage(request.headers['accept-language']) ??
      'en';

    if (exception instanceof AppException) {
      const status  = exception.getStatus();
      const res     = exception.getResponse() as any;
      const code: string = res?.error?.code ?? 'GEN_001';

      // Translate the error code; fall back to the original message from the
      // exception so existing behaviour is preserved when I18nService is absent.
      const message = this.i18n
        ? this.i18n.translateError(code, lang)
        : (res?.error?.message ?? 'An error occurred');

      return response.status(status).json({
        ...res,
        error: {
          ...res.error,
          message,
          lang,
          timestamp: new Date().toISOString(),
          path: request.url,
        },
      });
    }

    if (exception instanceof HttpException) {
      const status  = exception.getStatus();
      const res     = exception.getResponse() as any;
      const message = this.i18n
        ? this.i18n.translateError('GEN_001', lang)
        : (typeof res === 'string' ? res : res?.message ?? 'An error occurred');

      return response.status(status).json({
        success: false,
        error: {
          code:      `HTTP_${status}`,
          message,
          lang,
          timestamp: new Date().toISOString(),
          path:      request.url,
        },
      });
    }

    // Unknown exception — always GEN_001 in production, stack trace in dev
    const message = this.i18n
      ? this.i18n.translateError('GEN_001', lang)
      : 'Internal server error';

    return response.status(500).json({
      success: false,
      error: {
        code:      'GEN_001',
        message,
        lang,
        timestamp: new Date().toISOString(),
        path:      request.url,
        ...(process.env.NODE_ENV !== 'production' && {
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      },
    });
  }

  /**
   * Minimal Accept-Language parser — extracts the highest-priority base
   * language tag (e.g. "fr" from "fr-CA,fr;q=0.9,en;q=0.8").
   */
  private parseAcceptLanguage(header?: string): string | undefined {
    if (!header) return undefined;
    const lang = header.split(',')[0].split(';')[0].trim().split('-')[0].toLowerCase();
    const supported = new Set(['en', 'es', 'fr', 'de', 'zh', 'ja']);
    return supported.has(lang) ? lang : undefined;
  }
}