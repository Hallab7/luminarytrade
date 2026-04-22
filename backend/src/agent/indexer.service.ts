import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, ILike, Between, In } from "typeorm";
import { Agent } from "./entities/agent.entity";
import { CreateAgentDto } from "./dto/create-agent.dto";
import { SpecificationExecutor } from "./specification/specification.executor";
import { AgentQuerySpecification } from "./specification/agent-query.specification";
import { SearchAgentsDto } from "./dto/search-agent.dto";
import { HighPerformerSpec } from "./specification/high-performer.specification";
import { CacheManager } from "../cache/cache-manager.service";
import { CacheInvalidator } from "../cache/cache-invalidator.service";
import { Cacheable } from "../cache/decorators/cacheable.decorator";
import { CacheInvalidate } from "../cache/decorators/cache-invalidate.decorator";

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

@Injectable()
export class IndexerService {
  private readonly specificationExecutor: SpecificationExecutor<Agent>;

  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    private readonly cacheManager: CacheManager,
    private readonly cacheInvalidator: CacheInvalidator,
  ) {
    this.specificationExecutor = new SpecificationExecutor(
      this.agentRepository,
    );
  }

  @CacheInvalidate({ rule: 'agent:create' })
  async create(createAgentDto: CreateAgentDto): Promise<Agent> {
    const agent = this.agentRepository.create(createAgentDto);
    return await this.agentRepository.save(agent);
  }

  @Cacheable({
    key: (searchDto: SearchAgentsDto) => 
      `search:${JSON.stringify(searchDto)}`,
    ttl: 300, // 5 minutes
    namespace: 'agent',
  })
  async search(searchDto: SearchAgentsDto): Promise<PaginatedResponse<Agent>> {
    const spec = new AgentQuerySpecification(searchDto);

    const queryBuilder = this.specificationExecutor.execute(spec, "agent");

    const [data, total] = await queryBuilder.getManyAndCount();

    const page = searchDto.page || 1;
    const limit = searchDto.limit || 10;

    return {
      data,
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  @Cacheable({
    key: (id: string) => `agent:${id}`,
    ttl: 600, // 10 minutes
    namespace: 'agent',
  })
  async findOne(id: string): Promise<Agent> {
    const agent = await this.agentRepository.findOne({ where: { id } });
    if (!agent) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }
    return agent;
  }

  /** Batch-load agents by IDs — used by DataLoader to avoid N+1 queries */
  async findByIds(ids: string[]): Promise<Agent[]> {
    return this.agentRepository.findBy({ id: In(ids) as any });
  }

  @CacheInvalidate({
    rule: 'agent:performance-update',
    keys: (id: string) => [`agent:${id}`],
  })
  async updatePerformanceMetrics(
    id: string,
    metrics: Partial<Agent["performance_metrics"]>,
  ): Promise<Agent> {
    const agent = await this.findOne(id);
    agent.performance_metrics = { ...agent.performance_metrics, ...metrics };
    return await this.agentRepository.save(agent);
  }

  @CacheInvalidate({
    rule: 'agent:update',
    keys: (id: string) => [`agent:${id}`],
  })
  async update(id: string, updates: Partial<Agent>): Promise<Agent> {
    const agent = await this.findOne(id);
    Object.assign(agent, updates);
    return await this.agentRepository.save(agent);
  }

  @Cacheable({
    key: (limit: number = 10) => `top-performers:${limit}`,
    ttl: 300, // 5 minutes
    namespace: 'agent',
  })
  async getTopPerformers(limit: number = 10): Promise<Agent[]> {
    const spec = new HighPerformerSpec(limit);

    const queryBuilder = this.specificationExecutor.execute(spec, "agent");

    return await queryBuilder.getMany();
  }

  /**
   * Warm cache for critical queries
   */
  async warmCache(): Promise<void> {
    // Warm top performers cache
    await this.cacheManager.warm(
      'top-performers:10',
      () => this.getTopPerformers(10),
      { ttl: 300, namespace: 'agent' }
    );
  }
}
