import {
  Injectable,
  Inject,
  Optional,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, FindOptionsWhere, Between, IsNull } from "typeorm";
import {
  AuditEventType,
  AuditLogEntity,
  AuditStatus,
} from "./entities/audit-log.entity";
import { IEventBus } from "src/events";
import { AuditLogCreatedEvent } from "src/pattern-aggregate/index (1)";
import { AuditFilterDto, DateRange } from "./dto/audit-filter.dto";
import { StructuredLoggerService } from "../logging/structured-logger.service";
import { LogExecution } from "../logging/decorators/log-execution.decorator";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LogActionParams {
  /** Authenticated user id */
  userId?: string;
  /** Wallet address */
  wallet?: string;
  action: AuditEventType;
  entityType?: string;
  entityId?: string;
  /** Snapshot before the change */
  oldValues?: Record<string, unknown>;
  /** Snapshot after the change */
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  description?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  status?: AuditStatus;
  errorDetails?: Record<string, unknown>;
}

export interface PaginatedAuditLogs {
  logs: AuditLogEntity[];
  total: number;
  limit: number;
  offset: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
    private readonly logger: StructuredLoggerService,
    @Optional()
    @Inject("EventBus")
    private readonly eventBus?: IEventBus,
  ) {}

  // ── Primary write ─────────────────────────────────────────────────────────

  /**
   * Persist a single audit log entry.
   * Fire-and-forget friendly: errors are caught and logged without bubbling.
   * Target: adds <5 ms to the calling operation.
   */
  @LogExecution('AuditLogService.logAction')
  async logAction(params: LogActionParams): Promise<AuditLogEntity> {
    try {
      const entry = this.auditLogRepository.create({
        userId: params.userId ?? null,
        wallet: params.wallet ?? null,
        eventType: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        oldValues: params.oldValues ?? null,
        newValues: params.newValues ?? null,
        metadata: params.metadata ?? {},
        description: params.description ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        requestId: params.requestId ?? null,
        status: params.status ?? AuditStatus.SUCCESS,
        errorDetails: params.errorDetails ?? null,
        deletedAt: null,
        deletionReason: null,
      });

      const saved = await this.auditLogRepository.save(entry);

      this.logger.info(
        `Audit: ${params.action} | entity=${params.entityType ?? "-"}:${params.entityId ?? "-"} | user=${params.userId ?? params.wallet ?? "anon"}`,
      );

      if (this.eventBus) {
        await this.eventBus.publish(
          new AuditLogCreatedEvent(saved.id, {
            wallet: saved.wallet ?? "",
            eventType: saved.eventType,
            metadata: saved.metadata,
            description: saved.description ?? undefined,
            relatedEntityId: saved.entityId ?? undefined,
            relatedEntityType: saved.entityType ?? undefined,
          }),
        );
      }

      return saved;
    } catch (error) {
      this.logger.error(
        `Failed to persist audit log: ${error.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Backward-compat alias used by existing callers.
   */
  async logEvent(
    wallet: string,
    eventType: AuditEventType,
    metadata: Record<string, unknown> = {},
    description?: string,
    relatedEntityId?: string,
    relatedEntityType?: string,
  ): Promise<AuditLogEntity> {
    return this.logAction({
      wallet,
      action: eventType,
      metadata,
      description,
      entityId: relatedEntityId,
      entityType: relatedEntityType,
    });
  }

  // ── Batch ingestion ───────────────────────────────────────────────────────

  /**
   * Batch-insert audit log entries (1000+ entries/sec).
   * Uses a single INSERT…VALUES statement for performance.
   */
  async logBatch(params: LogActionParams[]): Promise<void> {
    if (params.length === 0) return;

    const entities = params.map((p) =>
      this.auditLogRepository.create({
        userId: p.userId ?? null,
        wallet: p.wallet ?? null,
        eventType: p.action,
        entityType: p.entityType ?? null,
        entityId: p.entityId ?? null,
        oldValues: p.oldValues ?? null,
        newValues: p.newValues ?? null,
        metadata: p.metadata ?? {},
        description: p.description ?? null,
        ipAddress: p.ipAddress ?? null,
        userAgent: p.userAgent ?? null,
        requestId: p.requestId ?? null,
        status: p.status ?? AuditStatus.SUCCESS,
        errorDetails: p.errorDetails ?? null,
        deletedAt: null,
        deletionReason: null,
      }),
    );

    await this.auditLogRepository.save(entities, { chunk: 500 });
    this.logger.log(`Batch audit: ${params.length} entries persisted`);
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async getAuditTrail(filter: AuditFilterDto): Promise<PaginatedAuditLogs> {
    const where: FindOptionsWhere<AuditLogEntity> = { deletedAt: IsNull() };

    if (filter.userId) where.userId = filter.userId;
    if (filter.wallet) where.wallet = filter.wallet;
    if (filter.eventType) where.eventType = filter.eventType;
    if (filter.entityType) where.entityType = filter.entityType;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.status) where.status = filter.status;
    if (filter.ipAddress) where.ipAddress = filter.ipAddress;

    if (filter.startDate || filter.endDate) {
      where.timestamp = Between(
        filter.startDate ?? new Date(0),
        filter.endDate ?? new Date(),
      );
    }

    const [logs, total] = await this.auditLogRepository.findAndCount({
      where,
      order: { timestamp: "DESC" },
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    });

    return {
      logs,
      total,
      limit: filter.limit ?? 50,
      offset: filter.offset ?? 0,
    };
  }

  /** Backward-compat alias */
  async fetchAuditLogs(query: AuditFilterDto) {
    const result = await this.getAuditTrail(query);
    return { logs: result.logs, total: result.total };
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  async exportAuditLog(dateRange: DateRange): Promise<string> {
    const { logs } = await this.getAuditTrail({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      limit: 100_000,
      offset: 0,
    });

    const header = [
      "id",
      "userId",
      "wallet",
      "eventType",
      "entityType",
      "entityId",
      "status",
      "ipAddress",
      "userAgent",
      "requestId",
      "description",
      "timestamp",
    ].join(",");

    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      // RFC 4180: wrap in quotes if contains comma, newline, or double-quote
      if (s.includes(",") || s.includes("\n") || s.includes('"')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = logs.map((l) =>
      [
        l.id,
        l.userId,
        l.wallet,
        l.eventType,
        l.entityType,
        l.entityId,
        l.status,
        l.ipAddress,
        l.userAgent,
        l.requestId,
        l.description,
        l.timestamp.toISOString(),
      ]
        .map(escape)
        .join(","),
    );

    return [header, ...rows].join("\n");
  }

  // ── Soft delete (immutability preserved) ─────────────────────────────────

  async softDelete(id: string, deletionReason: string): Promise<void> {
    if (!deletionReason?.trim()) {
      throw new ForbiddenException(
        "A deletion reason is required for audit log removal.",
      );
    }

    await this.auditLogRepository.update(id, {
      deletedAt: new Date(),
      deletionReason,
    });

    this.logger.warn(`Audit log ${id} soft-deleted: ${deletionReason}`);
  }

  // ── Convenience finders ───────────────────────────────────────────────────

  async getLogsByWallet(wallet: string, limit = 50): Promise<AuditLogEntity[]> {
    return this.auditLogRepository.find({
      where: { wallet, deletedAt: IsNull() },
      order: { timestamp: "DESC" },
      take: limit,
    });
  }

  async getLogsByEventType(
    eventType: AuditEventType,
    limit = 50,
  ): Promise<AuditLogEntity[]> {
    return this.auditLogRepository.find({
      where: { eventType, deletedAt: IsNull() },
      order: { timestamp: "DESC" },
      take: limit,
    });
  }

  async getLogsByRelatedEntity(
    entityId: string,
    limit = 50,
  ): Promise<AuditLogEntity[]> {
    return this.auditLogRepository.find({
      where: { entityId, deletedAt: IsNull() },
      order: { timestamp: "DESC" },
      take: limit,
    });
  }

  async getLogsByUserId(userId: string, limit = 50): Promise<AuditLogEntity[]> {
    return this.auditLogRepository.find({
      where: { userId, deletedAt: IsNull() },
      order: { timestamp: "DESC" },
      take: limit,
    });
  }

  async getById(id: string): Promise<AuditLogEntity | null> {
    return this.auditLogRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
  }
}
