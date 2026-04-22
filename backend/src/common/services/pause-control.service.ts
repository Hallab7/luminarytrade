/**
 * Pause/Resume Control Service for Emergency Halting
 * 
 * Provides granular pause states to control contract operations:
 * - RUNNING: normal operation
 * - PAUSED: no state-changing operations allowed
 * - PAUSED_WITH_READS: reads allowed, writes blocked
 * 
 * Authorization:
 * - Pause: requires ADMIN role or emergency key
 * - Resume: requires ADMIN role
 */

import { Injectable, ForbiddenException, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

// Pause states
export enum PauseState {
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  PAUSED_WITH_READS = 'PAUSED_WITH_READS',
}

// Custom error for paused contracts
export class ContractPausedError extends Error {
  constructor(
    message: string,
    public readonly currentState: PauseState,
    public readonly operation: string,
  ) {
    super(message);
    this.name = 'ContractPausedError';
  }
}

// Pause event types
export enum PauseEventType {
  PAUSED = 'PAUSED',
  RESUMED = 'RESUMED',
  STATE_CHANGED = 'STATE_CHANGED',
  EMERGENCY_PAUSE = 'EMERGENCY_PAUSE',
  EMERGENCY_OVERRIDE = 'EMERGENCY_OVERRIDE',
}

// Pause event for auditing
export interface PauseEvent {
  id: string;
  type: PauseEventType;
  previousState: PauseState;
  newState: PauseState;
  triggeredBy: string;
  reason?: string;
  timestamp: Date;
  emergencyOverride?: boolean;
}

// Pause service configuration
export interface PauseServiceConfig {
  emergencyKey?: string;
  defaultState?: PauseState;
  emitEvents?: boolean;
}

@Injectable()
export class PauseControlService {
  private currentState: PauseState = PauseState.RUNNING;
  private eventHistory: PauseEvent[] = [];
  private emergencyKey?: string;
  private emitEvents: boolean = true;

  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}

  /**
   * Initialize the pause service with configuration
   */
  initialize(config: PauseServiceConfig): void {
    this.emergencyKey = config.emergencyKey;
    this.currentState = config.defaultState || PauseState.RUNNING;
    this.emitEvents = config.emitEvents !== false;
  }

  /**
   * Get current pause state
   */
  getState(): PauseState {
    return this.currentState;
  }

  /**
   * Check if the contract is paused (any paused state)
   */
  isPaused(): boolean {
    return this.currentState !== PauseState.RUNNING;
  }

  /**
   * Check if a specific operation type is allowed
   */
  canExecute(operation: 'read' | 'write'): boolean {
    switch (operation) {
      case 'read':
        // Reads are always allowed unless fully paused (not implemented)
        return true;
      case 'write':
        // Writes are blocked in PAUSED state, allowed in RUNNING or PAUSED_WITH_READS
        return this.currentState === PauseState.RUNNING || 
               this.currentState === PauseState.PAUSED_WITH_READS;
      default:
        return false;
    }
  }

  /**
   * Check if a write operation can be executed
   * Throws ContractPausedError if not allowed
   */
  assertWritable(operation: string): void {
    if (!this.canExecute('write')) {
      throw new ContractPausedError(
        `Contract is paused in state: ${this.currentState}. Operation '${operation}' is not allowed.`,
        this.currentState,
        operation,
      );
    }
  }

  /**
   * Pause the contract - blocks all state-changing operations
   * Requires ADMIN role or emergency key
   */
  async pause(
    triggeredBy: string,
    reason?: string,
    emergencyKey?: string,
  ): Promise<PauseEvent> {
    // Check authorization: ADMIN role or emergency key
    const isAdmin = await this.checkAdminAuthorization(triggeredBy);
    const isEmergencyKey = emergencyKey === this.emergencyKey;

    if (!isAdmin && !isEmergencyKey) {
      throw new ForbiddenException(
        'Pause requires ADMIN role or valid emergency key',
      );
    }

    return this.setState(PauseState.PAUSED, triggeredBy, reason, isEmergencyKey);
  }

  /**
   * Pause with reads allowed - blocks writes only
   * Requires ADMIN role or emergency key
   */
  async pauseWithReads(
    triggeredBy: string,
    reason?: string,
    emergencyKey?: string,
  ): Promise<PauseEvent> {
    // Check authorization: ADMIN role or emergency key
    const isAdmin = await this.checkAdminAuthorization(triggeredBy);
    const isEmergencyKey = emergencyKey === this.emergencyKey;

    if (!isAdmin && !isEmergencyKey) {
      throw new ForbiddenException(
        'Pause with reads requires ADMIN role or valid emergency key',
      );
    }

    return this.setState(
      PauseState.PAUSED_WITH_READS,
      triggeredBy,
      reason,
      isEmergencyKey,
    );
  }

  /**
   * Resume the contract to RUNNING state
   * Requires ADMIN role only (no emergency key for resume)
   */
  async resume(triggeredBy: string, reason?: string): Promise<PauseEvent> {
    // Check authorization: ADMIN role only
    const isAdmin = await this.checkAdminAuthorization(triggeredBy);

    if (!isAdmin) {
      throw new ForbiddenException('Resume requires ADMIN role');
    }

    return this.setState(PauseState.RUNNING, triggeredBy, reason, false);
  }

  /**
   * Emergency override - super-admin only can bypass pause
   * This is a special override that should be used sparingly
   */
  async emergencyOverride(
    triggeredBy: string,
    operation: string,
  ): Promise<boolean> {
    // Check if user has super-admin role
    const isSuperAdmin = await this.checkSuperAdminAuthorization(triggeredBy);

    if (!isSuperAdmin) {
      throw new ForbiddenException(
        'Emergency override requires super-admin privileges',
      );
    }

    // Log the emergency override
    await this.logEmergencyOverride(triggeredBy, operation);

    return true;
  }

  /**
   * Get pause event history
   */
  getEventHistory(limit?: number): PauseEvent[] {
    if (limit) {
      return this.eventHistory.slice(-limit);
    }
    return [...this.eventHistory];
  }

  /**
   * Get events of a specific type
   */
  getEventsByType(type: PauseEventType): PauseEvent[] {
    return this.eventHistory.filter(event => event.type === type);
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Set the emergency key (should be done securely at initialization)
   */
  setEmergencyKey(key: string): void {
    this.emergencyKey = key;
  }

  /**
   * Get pause statistics
   */
  getStatistics(): {
    currentState: PauseState;
    totalEvents: number;
    lastPauseTime: Date | null;
    lastResumeTime: Date | null;
  } {
    const pauses = this.getEventsByType(PauseEventType.PAUSED);
    const resumes = this.getEventsByType(PauseEventType.RESUMED);

    return {
      currentState: this.currentState,
      totalEvents: this.eventHistory.length,
      lastPauseTime: pauses.length > 0 ? pauses[pauses.length - 1].timestamp : null,
      lastResumeTime: resumes.length > 0 ? resumes[resumes.length - 1].timestamp : null,
    };
  }

  // Private methods

  private async setState(
    newState: PauseState,
    triggeredBy: string,
    reason?: string,
    isEmergency: boolean = false,
  ): Promise<PauseEvent> {
    const previousState = this.currentState;
    this.currentState = newState;

    const event: PauseEvent = {
      id: this.generateEventId(),
      type: this.determineEventType(previousState, newState, isEmergency),
      previousState,
      newState,
      triggeredBy,
      reason,
      timestamp: new Date(),
      emergencyOverride: isEmergency,
    };

    this.eventHistory.push(event);

    // Cache the state for quick access
    await this.cache.set('pause:state', newState, 3600);

    return event;
  }

  private determineEventType(
    previousState: PauseState,
    newState: PauseState,
    isEmergency: boolean,
  ): PauseEventType {
    if (isEmergency && newState !== PauseState.RUNNING) {
      return PauseEventType.EMERGENCY_PAUSE;
    }
    if (previousState === PauseState.RUNNING && newState !== PauseState.RUNNING) {
      return PauseEventType.PAUSED;
    }
    if (previousState !== PauseState.RUNNING && newState === PauseState.RUNNING) {
      return PauseEventType.RESUMED;
    }
    return PauseEventType.STATE_CHANGED;
  }

  private async checkAdminAuthorization(userId: string): Promise<boolean> {
    // Check cache first
    const cacheKey = `auth:admin:${userId}`;
    const cached = await this.cache.get<boolean>(cacheKey);
    if (cached !== undefined) return cached;

    // In a real implementation, this would check the user's roles
    // For now, we'll check against a stored admin list
    const adminCacheKey = 'admin:users';
    const adminUsers = await this.cache.get<string[]>(adminCacheKey);
    
    const isAdmin = adminUsers?.includes(userId) || false;
    await this.cache.set(cacheKey, isAdmin, 300); // Cache for 5 minutes

    return isAdmin;
  }

  private async checkSuperAdminAuthorization(userId: string): Promise<boolean> {
    // Check cache first
    const cacheKey = `auth:superadmin:${userId}`;
    const cached = await this.cache.get<boolean>(cacheKey);
    if (cached !== undefined) return cached;

    // In a real implementation, this would check the user's roles
    const superAdminCacheKey = 'superadmin:users';
    const superAdminUsers = await this.cache.get<string[]>(superAdminCacheKey);
    
    const isSuperAdmin = superAdminUsers?.includes(userId) || false;
    await this.cache.set(cacheKey, isSuperAdmin, 300);

    return isSuperAdmin;
  }

  private async logEmergencyOverride(userId: string, operation: string): Promise<void> {
    const event: PauseEvent = {
      id: this.generateEventId(),
      type: PauseEventType.EMERGENCY_OVERRIDE,
      previousState: this.currentState,
      newState: this.currentState,
      triggeredBy: userId,
      reason: `Emergency override for operation: ${operation}`,
      timestamp: new Date(),
      emergencyOverride: true,
    };

    this.eventHistory.push(event);
  }

  private generateEventId(): string {
    return `pause_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Decorator for methods that need pause protection
export function Pausable(constructor: any) {
  const originalMethod = constructor.prototype.method;
  
  return class extends constructor {
    async method(...args: any[]) {
      const pauseService = args[0]?.pauseControlService;
      if (pauseService) {
        pauseService.assertWritable(originalMethod.name);
      }
      return originalMethod.apply(this, args);
    }
  };
}

// Guard for routes that need pause check
export class PauseGuard {
  constructor(private pauseControlService: PauseControlService) {}

  canActivate(operation: 'read' | 'write'): boolean {
    return this.pauseControlService.canExecute(operation);
  }
}