/**
 * Access Control List (ACL) Service
 * 
 * Enterprise-grade access control with multiple authorization strategies:
 * - Admin-only: Only admins can access
 * - Role-based: Users with specific roles can access
 * - Time-locked: Access only during specific time windows
 * - Approval-chain: Requires multiple approvals
 * 
 * Core features:
 * - AccessControl struct with role/permission mapping
 * - Role enum: ADMIN, MODERATOR, OPERATOR, VIEWER, CUSTOM
 * - Granular permission management
 */

import { Injectable, ForbiddenException } from '@nestjs/common';
import { Role, getInheritedRoles, hasRoleInheritance } from '../constant/roles.enum';
import { Action } from '../constant/actions.enum';

// Permission resource types
export enum ResourceType {
  AGENT = 'AGENT',
  USER = 'USER',
  CONTRACT = 'CONTRACT',
  TRANSACTION = 'TRANSACTION',
  AUDIT = 'AUDIT',
  ANALYTICS = 'ANALYTICS',
  SYSTEM = 'SYSTEM',
  CUSTOM = 'CUSTOM',
}

// Authorization strategies
export enum AuthorizationStrategy {
  ADMIN_ONLY = 'admin_only',
  ROLE_BASED = 'role_based',
  TIME_LOCKED = 'time_locked',
  APPROVAL_CHAIN = 'approval_chain',
  CUSTOM = 'custom',
}

// Time-locked access configuration
export interface TimeWindow {
  start: string; // HH:mm format
  end: string; // HH:mm format
  daysOfWeek?: number[]; // 0-6, Sunday = 0
}

// Approval chain configuration
export interface ApprovalStep {
  role: Role;
  required: boolean;
}

// Permission definition
export interface Permission {
  id: string;
  resource: ResourceType;
  action: Action;
  strategy: AuthorizationStrategy;
  allowedRoles?: Role[];
  timeWindow?: TimeWindow;
  approvalChain?: ApprovalStep[];
  conditions?: Record<string, any>;
}

// Access policy for a resource
export interface AccessPolicy {
  resource: ResourceType;
  permissions: Permission[];
  defaultStrategy: AuthorizationStrategy;
  inheritFrom?: ResourceType;
}

// ACL configuration
export interface ACLConfig {
  enableAuditLog?: boolean;
  enableCaching?: boolean;
  cacheTimeout?: number; // seconds
  defaultRole?: Role;
}

// User context for authorization
export interface UserContext {
  userId: string;
  roles: Role[];
  permissions?: string[];
  metadata?: Record<string, any>;
}

// Authorization result
export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
  approvalSteps?: ApprovalStep[];
}

// ACL Service
@Injectable()
export class ACLService {
  private policies: Map<ResourceType, AccessPolicy> = new Map();
  private config: ACLConfig;
  private permissionCache: Map<string, AuthorizationResult> = new Map();

  constructor() {
    this.config = {
      enableAuditLog: true,
      enableCaching: true,
      cacheTimeout: 300, // 5 minutes
      defaultRole: Role.VIEWER,
    };
    
    this.initializeDefaultPolicies();
  }

  /**
   * Initialize ACL with configuration
   */
  initialize(config: ACLConfig): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Register an access policy for a resource
   */
  registerPolicy(policy: AccessPolicy): void {
    this.policies.set(policy.resource, policy);
  }

  /**
   * Check if user has access to perform action on resource
   */
  async canAccess(
    user: UserContext,
    resource: ResourceType,
    action: Action,
    context?: Record<string, any>,
  ): Promise<AuthorizationResult> {
    // Generate cache key
    const cacheKey = this.getCacheKey(user, resource, action);
    
    // Check cache
    if (this.config.enableCaching) {
      const cached = this.permissionCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Get policy for resource
    const policy = this.policies.get(resource);
    if (!policy) {
      // No policy defined, allow by default
      return { allowed: true, reason: 'No policy defined' };
    }

    // Find matching permission
    const permission = policy.permissions.find(
      p => p.resource === resource && p.action === action,
    );

    if (!permission) {
      // No permission defined for this action
      return { allowed: false, reason: 'No permission defined for this action' };
    }

    // Evaluate based on strategy
    let result: AuthorizationResult;

    switch (permission.strategy) {
      case AuthorizationStrategy.ADMIN_ONLY:
        result = this.evaluateAdminOnly(user);
        break;
      
      case AuthorizationStrategy.ROLE_BASED:
        result = this.evaluateRoleBased(user, permission);
        break;
      
      case AuthorizationStrategy.TIME_LOCKED:
        result = this.evaluateTimeLocked(user, permission, context);
        break;
      
      case AuthorizationStrategy.APPROVAL_CHAIN:
        result = this.evaluateApprovalChain(user, permission);
        break;
      
      case AuthorizationStrategy.CUSTOM:
        result = this.evaluateCustom(user, permission, context);
        break;
      
      default:
        result = { allowed: false, reason: 'Unknown authorization strategy' };
    }

    // Cache result
    if (this.config.enableCaching && result.allowed) {
      this.permissionCache.set(cacheKey, result);
    }

    // Audit log
    if (this.config.enableAuditLog) {
      this.logAccessAttempt(user, resource, action, result);
    }

    return result;
  }

  /**
   * Assert access - throws ForbiddenException if not allowed
   */
  async assertAccess(
    user: UserContext,
    resource: ResourceType,
    action: Action,
    context?: Record<string, any>,
  ): Promise<void> {
    const result = await this.canAccess(user, resource, action, context);
    
    if (!result.allowed) {
      throw new ForbiddenException(result.reason || 'Access denied');
    }

    if (result.requiresApproval && result.approvalSteps) {
      throw new ForbiddenException(
        `This action requires approval from: ${result.approvalSteps
          .map(s => s.role)
          .join(', ')}`,
      );
    }
  }

  /**
   * Get all permissions for a user on a resource
   */
  getUserPermissions(user: UserContext, resource: ResourceType): Permission[] {
    const policy = this.policies.get(resource);
    if (!policy) return [];

    return policy.permissions.filter(p => {
      if (!p.allowedRoles || p.allowedRoles.length === 0) return true;
      
      return p.allowedRoles.some(role => 
        user.roles.some(userRole => hasRoleInheritance(userRole, role)),
      );
    });
  }

  /**
   * Check if user has specific permission
   */
  hasPermission(user: UserContext, permissionId: string): boolean {
    return user.permissions?.includes(permissionId) || false;
  }

  /**
   * Grant permission to user
   */
  grantPermission(user: UserContext, permissionId: string): UserContext {
    return {
      ...user,
      permissions: [...(user.permissions || []), permissionId],
    };
  }

  /**
   * Revoke permission from user
   */
  revokePermission(user: UserContext, permissionId: string): UserContext {
    return {
      ...user,
      permissions: (user.permissions || []).filter(p => p !== permissionId),
    };
  }

  /**
   * Clear permission cache
   */
  clearCache(): void {
    this.permissionCache.clear();
  }

  /**
   * Get all registered policies
   */
  getPolicies(): Map<ResourceType, AccessPolicy> {
    return new Map(this.policies);
  }

  // Private evaluation methods

  private evaluateAdminOnly(user: UserContext): AuthorizationResult {
    const isAdmin = user.roles.includes(Role.ADMIN);
    const isSuperAdmin = user.roles.includes(Role.SUPER_ADMIN);
    
    if (isAdmin || isSuperAdmin) {
      return { allowed: true, reason: 'Admin access granted' };
    }
    
    return { 
      allowed: false, 
      reason: 'This resource requires admin access' 
    };
  }

  private evaluateRoleBased(user: UserContext, permission: Permission): AuthorizationResult {
    if (!permission.allowedRoles || permission.allowedRoles.length === 0) {
      return { allowed: true, reason: 'No role restrictions' };
    }

    const hasRole = user.roles.some(userRole =>
      permission.allowedRoles!.some(allowedRole => 
        hasRoleInheritance(userRole, allowedRole),
      ),
    );

    if (hasRole) {
      return { allowed: true, reason: 'Role-based access granted' };
    }

    return {
      allowed: false,
      reason: `Required roles: ${permission.allowedRoles.join(', ')}`,
    };
  }

  private evaluateTimeLocked(
    user: UserContext, 
    permission: Permission, 
    context?: Record<string, any>,
  ): AuthorizationResult {
    if (!permission.timeWindow) {
      return { allowed: true, reason: 'No time window defined' };
    }

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const currentDay = now.getDay();

    const window = permission.timeWindow;
    
    // Check day of week
    if (window.daysOfWeek && !window.daysOfWeek.includes(currentDay)) {
      return {
        allowed: false,
        reason: `Access not available on day ${currentDay}`,
      };
    }

    // Check time window
    if (currentTime >= window.start && currentTime <= window.end) {
      return { allowed: true, reason: 'Within time window' };
    }

    return {
      allowed: false,
      reason: `Access only available between ${window.start} and ${window.end}`,
    };
  }

  private evaluateApprovalChain(
    user: UserContext, 
    permission: Permission,
  ): AuthorizationResult {
    if (!permission.approvalChain || permission.approvalChain.length === 0) {
      return { allowed: true, reason: 'No approval chain required' };
    }

    // Check if user meets approval requirements
    const userRoleHighest = this.getHighestRole(user.roles);
    
    const requiredApproval = permission.approvalChain.find(
      step => step.required && userRoleHighest === step.role,
    );

    if (requiredApproval) {
      return { allowed: true, reason: 'User is an approver in chain' };
    }

    // Return requiring approval
    return {
      allowed: false,
      requiresApproval: true,
      approvalSteps: permission.approvalChain,
      reason: 'This action requires approval chain',
    };
  }

  private evaluateCustom(
    user: UserContext, 
    permission: Permission, 
    context?: Record<string, any>,
  ): AuthorizationResult {
    // Custom evaluation based on conditions
    if (!permission.conditions) {
      return { allowed: true, reason: 'No conditions defined' };
    }

    // Evaluate conditions
    for (const [key, value] of Object.entries(permission.conditions)) {
      const contextValue = context?.[key];
      
      if (contextValue === undefined) {
        return {
          allowed: false,
          reason: `Missing required context: ${key}`,
        };
      }

      if (contextValue !== value) {
        return {
          allowed: false,
          reason: `Condition not met: ${key} = ${value}`,
        };
      }
    }

    return { allowed: true, reason: 'Custom conditions met' };
  }

  private getHighestRole(roles: Role[]): Role {
    const hierarchy = [
      Role.SUPER_ADMIN,
      Role.ADMIN,
      Role.MODERATOR,
      Role.OPERATOR,
      Role.VIEWER,
      Role.CUSTOM,
    ];

    for (const role of hierarchy) {
      if (roles.includes(role)) {
        return role;
      }
    }

    return Role.VIEWER;
  }

  private getCacheKey(user: UserContext, resource: ResourceType, action: Action): string {
    return `${user.userId}:${resource}:${action}:${user.roles.sort().join(',')}`;
  }

  private logAccessAttempt(
    user: UserContext, 
    resource: ResourceType, 
    action: Action, 
    result: AuthorizationResult,
  ): void {
    // In production, this would log to the audit system
    console.log(`[ACL] Access ${result.allowed ? 'GRANTED' : 'DENIED'}: ${user.userId} on ${resource}:${action} - ${result.reason}`);
  }

  private initializeDefaultPolicies(): void {
    // Agent resource policy
    this.registerPolicy({
      resource: ResourceType.AGENT,
      permissions: [
        {
          id: 'agent:create',
          resource: ResourceType.AGENT,
          action: Action.CREATE,
          strategy: AuthorizationStrategy.ROLE_BASED,
          allowedRoles: [Role.ADMIN, Role.OPERATOR],
        },
        {
          id: 'agent:read',
          resource: ResourceType.AGENT,
          action: Action.READ,
          strategy: AuthorizationStrategy.ROLE_BASED,
          allowedRoles: [Role.ADMIN, Role.MODERATOR, Role.OPERATOR, Role.VIEWER],
        },
        {
          id: 'agent:update',
          resource: ResourceType.AGENT,
          action: Action.UPDATE,
          strategy: AuthorizationStrategy.ROLE_BASED,
          allowedRoles: [Role.ADMIN, Role.MODERATOR],
        },
        {
          id: 'agent:delete',
          resource: ResourceType.AGENT,
          action: Action.DELETE,
          strategy: AuthorizationStrategy.ADMIN_ONLY,
        },
      ],
      defaultStrategy: AuthorizationStrategy.ROLE_BASED,
    });

    // User resource policy
    this.registerPolicy({
      resource: ResourceType.USER,
      permissions: [
        {
          id: 'user:create',
          resource: ResourceType.USER,
          action: Action.CREATE,
          strategy: AuthorizationStrategy.ADMIN_ONLY,
        },
        {
          id: 'user:read',
          resource: ResourceType.USER,
          action: Action.READ,
          strategy: AuthorizationStrategy.ROLE_BASED,
          allowedRoles: [Role.ADMIN, Role.MODERATOR],
        },
        {
          id: 'user:update',
          resource: ResourceType.USER,
          action: Action.UPDATE,
          strategy: AuthorizationStrategy.ROLE_BASED,
          allowedRoles: [Role.ADMIN],
        },
        {
          id: 'user:delete',
          resource: ResourceType.USER,
          action: Action.DELETE,
          strategy: AuthorizationStrategy.ADMIN_ONLY,
        },
      ],
      defaultStrategy: AuthorizationStrategy.ROLE_BASED,
    });

    // System resource policy
    this.registerPolicy({
      resource: ResourceType.SYSTEM,
      permissions: [
        {
          id: 'system:read',
          resource: ResourceType.SYSTEM,
          action: Action.READ,
          strategy: AuthorizationStrategy.ROLE_BASED,
          allowedRoles: [Role.ADMIN, Role.SUPER_ADMIN],
        },
        {
          id: 'system:write',
          resource: ResourceType.SYSTEM,
          action: Action.CREATE,
          strategy: AuthorizationStrategy.ADMIN_ONLY,
        },
      ],
      defaultStrategy: AuthorizationStrategy.ADMIN_ONLY,
    });
  }
}

// Guard for NestJS routes
export class ACLGuard {
  constructor(private aclService: ACLService) {}

  async canActivate(
    user: UserContext,
    resource: ResourceType,
    action: Action,
  ): Promise<boolean> {
    const result = await this.aclService.canAccess(user, resource, action);
    return result.allowed;
  }
}

// Decorator for ACL-protected methods
export function RequireAccess(resource: ResourceType, action: Action) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const aclService = args[0]?.aclService;
      const user = args[0]?.user;

      if (aclService && user) {
        await aclService.assertAccess(user, resource, action);
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}