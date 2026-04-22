import { Injectable } from '@nestjs/common';
import { I18nService as NestI18nService, I18nContext } from 'nestjs-i18n';

type TranslationArgs = Record<string, string | number>;

const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'zh', 'ja'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

@Injectable()
export class I18nService {
    constructor(private readonly nestI18n: NestI18nService) {}

    // ── Language detection ──────────────────────────────────────────────────

    currentLang(): string {
        return I18nContext.current()?.lang ?? 'en';
    }

    normaliseLanguage(raw: string): SupportedLanguage {
        const base = raw.split('-')[0].toLowerCase() as SupportedLanguage;
        return SUPPORTED_LANGUAGES.includes(base) ? base : 'en';
    }

    // ── Translation helpers ─────────────────────────────────────────────────

    /**
     * Translate an error code to a localised message.
     *
     * @param code  — e.g. "AUTH_001", "TXN_004"
     * @param lang  — ISO 639-1 code; defaults to current request language
     */
    translateError(code: string, lang?: string): string {
        return this.translate(`messages.errors.${code}`, {}, lang);
    }

    /**
     * Translate a validation message key with optional interpolation args.
     *
     * @param key   — e.g. "required", "minLength"
     * @param args  — e.g. { field: 'Email', min: 8 }
     * @param lang  — ISO 639-1 code; defaults to current request language
     */
    translateValidation(
        key: string,
        args: TranslationArgs = {},
        lang?: string,
    ): string {
        return this.translate(`messages.validation.${key}`, args, lang);
    }

    /**
     * Translate an API response message key.
     *
     * @param key  — e.g. "created", "loginSuccess"
     * @param lang — ISO 639-1 code; defaults to current request language
     */
    translateResponse(key: string, lang?: string): string {
        return this.translate(`messages.responses.${key}`, {}, lang);
    }

    /**
     * Translate a field label (used in validation messages for the {field}
     * placeholder when the caller holds only a field name string).
     *
     * @param field — camelCase field name, e.g. "firstName", "email"
     * @param lang  — ISO 639-1 code; defaults to current request language
     */
    translateField(field: string, lang?: string): string {
        return this.translate(`messages.fields.${field}`, {}, lang);
    }

    // ── Internal ────────────────────────────────────────────────────────────

    private translate(
        key: string,
        args: TranslationArgs,
        lang?: string,
    ): string {
        const targetLang = lang ?? this.currentLang();

        try {
        const result = this.nestI18n.translate(key, { lang: targetLang, args });
        if (result && result !== key) return String(result);
        } catch {
        // fall through to English fallback
        }

        // English fallback
        try {
        const fallback = this.nestI18n.translate(key, { lang: 'en', args });
        if (fallback && fallback !== key) return String(fallback);
        } catch {
        // fall through to key
        }

        // Last resort — return the bare key so at least something shows
        return key;
    }
}