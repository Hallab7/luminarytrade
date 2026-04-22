import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';

/**
 * @Language() decorator
 *
 * Injects the resolved language code for the current request into a
 * controller method parameter. Useful when you need to pass the language
 * explicitly to a service method.
 *
 * Resolution priority:
 *   1. X-Language header
 *   2. User language preference (from JWT)
 *   3. Accept-Language header
 *   4. 'en' default
 *
 * @example
 * ```ts
 * @Get('status')
 * async getStatus(@Language() lang: string) {
 *   return { message: this.i18n.translateResponse('healthOk', lang) };
 * }
 * ```
 */
export const Language = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    return I18nContext.current(ctx)?.lang ?? 'en';
  },
);

/**
 * @CurrentUser() — already exists elsewhere in the project; this is a
 * companion that also exposes the user's saved language preference.
 *
 * @example
 * ```ts
 * @Patch('profile')
 * async updateProfile(@UserLang() lang: string) { ... }
 * ```
 */
export const UserLang = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const userLang: string | undefined = request?.user?.language;
    return userLang ?? I18nContext.current(ctx)?.lang ?? 'en';
  },
);

/**
 * @Translatable() class decorator
 *
 * Marks a DTO or entity class as having translatable validation messages.
 * Used as a signal to code-generation tooling and documentation — no
 * runtime behaviour is attached.
 *
 * @example
 * ```ts
 * @Translatable()
 * export class CreateUserDto { ... }
 * ```
 */
export function Translatable(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata('translatable', true, target);
  };
}

/**
 * @I18nMessage(key) property decorator
 *
 * Annotates a DTO property with the i18n key that should be used for its
 * validation error messages. The I18nValidationPipe reads this to produce
 * localised constraint messages.
 *
 * @example
 * ```ts
 * @Translatable()
 * export class LoginDto {
 *   @I18nMessage('email')
 *   @IsEmail()
 *   email: string;
 * }
 * ```
 */
export function I18nMessage(fieldKey: string): PropertyDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata('i18n:field', fieldKey, target, propertyKey);
  };
}