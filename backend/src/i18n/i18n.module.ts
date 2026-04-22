import { Module } from '@nestjs/common';
import { I18nModule as NestI18nModule, AcceptLanguageResolver, HeaderResolver } from 'nestjs-i18n';
import * as path from 'path';
import { I18nService } from './i18n.service';
import { UserLanguageResolver } from './resolvers/user-language.resolver';

@Module({
    imports: [
        NestI18nModule.forRoot({
            fallbackLanguage: 'en',
            loaderOptions: {
                path: path.join(__dirname, '../../i18n'),
                watch: process.env.NODE_ENV !== 'production',
            },
            resolvers: [
                new HeaderResolver(['x-language']),
                UserLanguageResolver,
                AcceptLanguageResolver,
            ],
            throwOnMissingKey: false,
        }),
    ],
    providers: [I18nService, UserLanguageResolver],
    exports: [I18nService],
})
export class I18nModule {}