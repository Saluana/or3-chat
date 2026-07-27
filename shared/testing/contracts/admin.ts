import type {
    AdminStoreCapabilities,
    AdminUserStore,
    WorkspaceAccessStore,
    WorkspaceSettingsStore,
} from '../../../server/admin/stores/types';

export interface AdminStoreContractSubject {
    name: string;
    workspaceAccess: WorkspaceAccessStore;
    workspaceSettings: WorkspaceSettingsStore;
    adminUsers: AdminUserStore;
    capabilities: AdminStoreCapabilities;
}

const ACCESS_METHODS = [
    'listMembers',
    'upsertMember',
    'setMemberRole',
    'removeMember',
    'listWorkspaces',
    'getWorkspace',
    'createWorkspace',
    'softDeleteWorkspace',
    'restoreWorkspace',
    'searchUsers',
] as const;
const SETTINGS_METHODS = ['get', 'set'] as const;
const ADMIN_USER_METHODS = [
    'listAdmins',
    'grantAdmin',
    'revokeAdmin',
    'isAdmin',
    'searchUsers',
] as const;

/**
 * Verifies the provider exposes every operation required by the admin routes.
 * This intentionally fails providers that advertise a capability but return a
 * partial store whose missing method would otherwise surface only at runtime.
 */
export function verifyAdminStoreProviderContract(
    subject: AdminStoreContractSubject,
): void {
    for (const method of ACCESS_METHODS) {
        if (typeof subject.workspaceAccess[method] !== 'function') {
            throw new Error(`${subject.name} workspace access store is missing ${method}`);
        }
    }
    for (const method of SETTINGS_METHODS) {
        if (typeof subject.workspaceSettings[method] !== 'function') {
            throw new Error(`${subject.name} workspace settings store is missing ${method}`);
        }
    }
    for (const method of ADMIN_USER_METHODS) {
        if (typeof subject.adminUsers[method] !== 'function') {
            throw new Error(`${subject.name} admin user store is missing ${method}`);
        }
    }

    for (const [capability, value] of Object.entries(subject.capabilities)) {
        if (typeof value !== 'boolean') {
            throw new Error(`${subject.name} capability ${capability} must be boolean`);
        }
    }
}
