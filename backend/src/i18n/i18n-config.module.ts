import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  I18nModule,
  AcceptLanguageResolver,
  HeaderResolver,
  QueryResolver,
} from 'nestjs-i18n';
import * as path from 'path';

/**
 * #242 — Multi-Language Support
 *
 * Supported languages: en, es, fr, de, ja, zh
 * Translation files live in: src/i18n/<lang>/
 * Fallback language: en
 *
 * Language is resolved in this priority order:
 *   1. ?lang= query param
 *   2. Accept-Language header
 *   3. x-lang custom header
 *   4. Falls back to 'en'
 */
@Module({
  imports: [
    I18nModule.forRootAsync({
      useFactory: () => ({
        fallbackLanguage: 'en',
        loaderOptions: {
          path: path.join(__dirname, '../../i18n/'),
          watch: process.env.NODE_ENV === 'development',
        },
      }),
      resolvers: [
        new QueryResolver(['lang', 'locale']),
        new AcceptLanguageResolver(),
        new HeaderResolver(['x-lang']),
      ],
      imports: [ConfigModule],
      inject: [ConfigService],
    }),
  ],
  exports: [I18nModule],
})
export class I18nConfigModule {}