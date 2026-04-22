/**
 * Common Services Module
 * 
 * Exports all common services for use throughout the application:
 * - PauseControlService: Emergency pause/resume functionality
 * - StorageOptimizationService: Compression and serialization
 * - ACLService: Access Control List with multiple authorization strategies
 * 
 * Usage:
 * import { PauseControlService, ACLService, StorageOptimizationService } from '../common/services';
 */

export * from './pause-control.service';
export * from './storage-optimization.service';
export * from './acl.service';
export * from './base-service.interface';

// Also export constants
export * from '../constant/roles.enum';
export * from '../constant/actions.enum';