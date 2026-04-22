import { Module } from '@nestjs/common';
import { GraphQLISODateTime, GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import GraphQLJSON from 'graphql-type-json';
import { IndexerModule } from '../agent/agent.module';
import { OracleModule } from '../oracle/oracle.module';
import { SubmitterModule } from '../submitter/submitter.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { AgentResolver } from './resolvers/agent.resolver';
import { OracleResolver } from './resolvers/oracle.resolver';
import { SubmissionResolver } from './resolvers/submission.resolver';
import { AuditLogResolver } from './resolvers/audit-log.resolver';
import { GraphqlPubSub } from './pubsub.service';
import { GqlJwtAuthGuard } from './guards/gql-jwt-auth.guard';
import { formatGraphqlError } from './graphql-error.formatter';
import { DataLoaderService } from './dataloader.service';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      typePaths: [join(process.cwd(), 'src/graphql/schema.graphql')],
      introspection: true,
      playground: true,
      subscriptions: {
        'graphql-ws': true,
      },
      context: ({ req, connectionParams }) => {
        if (req) {
          return { req };
        }

        const authHeader =
          (connectionParams?.authorization as string) ||
          (connectionParams?.Authorization as string);

        return {
          req: {
            headers: {
              authorization: authHeader,
            },
          },
        };
      },
      resolvers: {
        JSON: GraphQLJSON,
        DateTime: GraphQLISODateTime,
      },
      formatError: formatGraphqlError,
    }),
    IndexerModule,
    OracleModule,
    SubmitterModule,
    AuditLogModule,
  ],
  providers: [
    AgentResolver,
    OracleResolver,
    SubmissionResolver,
    AuditLogResolver,
    GraphqlPubSub,
    GqlJwtAuthGuard,
    DataLoaderService,
  ],
})
export class GraphqlApiModule {}
