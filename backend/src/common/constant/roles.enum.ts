/**
 * Roles Enum
 * Defines the available roles in the system
 */

export enum Role {
  ADMIN = 'ADMIN',
  MODERATOR = 'MODERATOR',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER',
  SUPER_ADMIN = 'SUPER_ADMIN',
  CUSTOM = 'CUSTOM',
}

// Role hierarchy for authorization
export const ROLE_HIERARCHY: Record<Role, Role[]> = {
  [Role.SUPER_ADMIN]: [Role.SUPER_ADMIN, Role.ADMIN, Role.MODERATOR, Role.OPERATOR, Role.VIEWER],
  [Role.ADMIN]: [Role.ADMIN, Role.MODERATOR, Role.OPERATOR, Role.VIEWER],
  [Role.MODERATOR]: [Role.MODERATOR, Role.OPERATOR, Role.VIEWER],
  [Role.OPERATOR]: [Role.OPERATOR, Role.VIEWER],
  [Role.VIEWER]: [Role.VIEWER],
  [Role.CUSTOM]: [Role.CUSTOM],
};

// Get all roles that inherit from a given role
export function getInheritedRoles(role: Role): Role[] {
  return ROLE_HIERARCHY[role] || [];
}

// Check if role A inherits from role B
export function hasRoleInheritance(roleA: Role, roleB: Role): boolean {
  return ROLE_HIERARCHY[roleA]?.includes(roleB) || false;
}