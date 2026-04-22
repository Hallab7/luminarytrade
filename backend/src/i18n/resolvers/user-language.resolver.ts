import { Injectable, ExecutionContext } from '@nestjs/common';
import { I18nResolver } from 'nestjs-i18n';

const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'fr', 'de', 'zh', 'ja']);

@Injectable()
export class UserLanguageResolver implements I18nResolver {
    resolve(context: ExecutionContext): string | undefined {
        const request = context.switchToHttp().getRequest();
        const lang: string | undefined = request?.user?.language;

        if (lang && SUPPORTED_LANGUAGES.has(lang.toLowerCase())) {
            return lang.toLowerCase();
        }

        return undefined;
    }
}