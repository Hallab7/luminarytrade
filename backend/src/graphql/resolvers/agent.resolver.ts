import { Args, Context, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { IndexerService } from '../../agent/indexer.service';
import {
  AgentFilterInput,
  CreateAgentInput,
  UpdateAgentInput,
} from '../types/graphql-inputs';
import { GraphqlPubSub } from '../pubsub.service';
import { AGENT_UPDATED_EVENT } from '../graphql.constants';
import { GqlJwtAuthGuard } from '../guards/gql-jwt-auth.guard';
import { DataLoaderService } from '../dataloader.service';

const MAX_PAGE_SIZE = 100;

@Resolver('Agent')
export class AgentResolver {
  constructor(
    private readonly indexerService: IndexerService,
    private readonly pubSub: GraphqlPubSub,
    private readonly dataLoaderService: DataLoaderService,
  ) {}

  @Query('agent')
  async agent(@Args('id') id: string) {
    // Use DataLoader to batch/deduplicate single-item lookups
    return this.dataLoaderService.agentLoader.load(id);
  }

  @Query('agents')
  async agents(
    @Args('limit', { nullable: true }) limit = 10,
    @Args('offset', { nullable: true }) offset = 0,
    @Args('filter', { nullable: true }) filter?: AgentFilterInput,
  ) {
    const safeLimit = Math.min(limit, MAX_PAGE_SIZE);
    const page = Math.floor(offset / safeLimit) + 1;
    const result = await this.indexerService.search({
      ...(filter || {}),
      page,
      limit: safeLimit,
    });
    return result.data;
  }

  @Query('searchAgents')
  async searchAgents(
    @Args('term') term: string,
    @Args('limit', { nullable: true }) limit = 10,
    @Args('offset', { nullable: true }) offset = 0,
  ) {
    const safeLimit = Math.min(limit, MAX_PAGE_SIZE);
    const page = Math.floor(offset / safeLimit) + 1;
    const result = await this.indexerService.search({
      name: term,
      page,
      limit: safeLimit,
    });
    return result.data;
  }

  @Query('agentStats')
  async agentStats() {
    const result = await this.indexerService.search({ page: 1, limit: 100 });
    const total = result.meta.total;
    const active = result.data.filter((agent) => agent.is_active).length;
    const avgEvolutionLevel =
      result.data.length === 0
        ? 0
        : result.data.reduce((sum, agent) => sum + agent.evolution_level, 0) /
          result.data.length;

    return {
      total,
      active,
      avgEvolutionLevel,
    };
  }

  @UseGuards(GqlJwtAuthGuard)
  @Mutation('createAgent')
  async createAgent(@Args('input') input: CreateAgentInput) {
    return this.indexerService.create(input);
  }

  @UseGuards(GqlJwtAuthGuard)
  @Mutation('updateAgent')
  async updateAgent(
    @Args('id') id: string,
    @Args('input') input: UpdateAgentInput,
  ) {
    const updated = await this.indexerService.update(id, input);
    await this.pubSub.pubSub.publish(AGENT_UPDATED_EVENT, { agentUpdated: updated });
    return updated;
  }

  @Subscription('agentUpdated', {
    resolve: (payload) => payload.agentUpdated,
  })
  agentUpdated() {
    return this.pubSub.pubSub.asyncIterator(AGENT_UPDATED_EVENT);
  }
}
