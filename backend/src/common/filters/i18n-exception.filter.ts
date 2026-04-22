import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { I18nService, I18nContext } from 'nestjs-i18n';
import { Request, Response } from 'express';

/**
 * #242 — Global exception filter that translates all HTTP error messages
 * into the request's negotiated language before sending the response.
 *
 * Register in main.ts:
 *   app.useGlobalFilters(new I18nExceptionFilter(i18nService));
 */
@Catch(HttpException)
@Injectable()
export class I18nExceptionFilter implements ExceptionFilter {
  constructor(private readonly i18n: I18nService) {}

  async catch(exception: HttpException, host: ArgumentsHost) {
    const ctx  = host.switchToHttp();
    const res  = ctx.getResponse<Response>();
    const req  = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const lang = I18nContext.current()?.lang ?? 'en';

    // Map HTTP status codes to translation keys
    const keyMap: Record<number, string> = {
      [HttpStatus.NOT_FOUND]:             'common.not_found',
      [HttpStatus.UNAUTHORIZED]:          'common.unauthorized',
      [HttpStatus.FORBIDDEN]:             'common.forbidden',
      [HttpStatus.BAD_REQUEST]:           'common.bad_request',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'common.internal_error',
      [HttpStatus.CONFLICT]:              'common.conflict',
      [HttpStatus.UNPROCESSABLE_ENTITY]:  'common.validation_error',
    };

    const translationKey = keyMap[status] ?? 'common.internal_error';

    // If the exception already carries a translation key (e.g. 'auth.login_failed'),
    // use it directly; otherwise fall back to the status-based key.
    const exceptionResponse = exception.getResponse() as any;
    const messageKey = typeof exceptionResponse?.messageKey === 'string'
      ? exceptionResponse.messageKey
      : translationKey;

    const args = exceptionResponse?.args ?? {};
    const message = await this.i18n.translate(messageKey, { lang, args });

    res.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: req.url,
    });
  }
}