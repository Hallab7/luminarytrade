import { Injectable, Scope } from '@nestjs/common';
import DataLoader from 'dataloader';
import { IndexerService } from '../agent/indexer.service';
import { OracleService } from '../oracle/oracle.service';
import { SubmitterService } from '../submitter/submitter.service';

/**
 * Issue #239 — Reduce Memory Usage in GraphQL Resolvers
 *
 * REQUEST-scoped so each GraphQL request gets its own DataLoader instances,
 * which batch and deduplicate DB calls within a single request tick.
 */
@Injectable({ scope: Scope.REQUEST })
export class DataLoaderService {
  constructor(
    private readonly indexerService: IndexerService,
    private readonly oracleService: OracleService,
    private readonly submitterService: SubmitterService,
  ) {}

  /** Batch-load agents by ID */
  readonly agentLoader = new DataLoader<string, unknown>(
    async (ids: readonly string[]) => {
      const agents = await this.indexerService.findByIds([...ids]);
      const map = new Map(agents.map((a: any) => [a.id, a]));
      return ids.map((id) => map.get(id) ?? null);
    },
    { maxBatchSize: 100 },
  );

  /** Batch-load oracle snapshots by ID */
  readonly oracleLoader = new DataLoader<string, unknown>(
    async (ids: readonly string[]) => {
      const snapshots = await Promise.all(
        ids.map((id) => this.oracleService.getSnapshotAsOracle(id).catch(() => null)),
      );
      return snapshots;
    },
    { maxBatchSize: 50 },
  );

  /** Batch-load submissions by ID */
  readonly submissionLoader = new DataLoader<string, unknown>(
    async (ids: readonly string[]) => {
      const submissions = await Promise.all(
        ids.map((id) => this.submitterService.getSubmission(id).catch(() => null)),
      );
      return submissions;
    },
    { maxBatchSize: 100 },
  );
}
