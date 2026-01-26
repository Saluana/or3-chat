export type AdminHookKey =
    | 'admin.plugin:action:installed'
    | 'admin.plugin:action:enabled'
    | 'admin.plugin:action:disabled'
    | 'admin.user:action:role_changed';

export interface AdminHookPayloadMap {
    'admin.plugin:action:installed': [
        payload: { id: string; kind: 'plugin' | 'theme' | 'admin_plugin'; version: string }
    ];
    'admin.plugin:action:enabled': [payload: { id: string; workspaceId: string }];
    'admin.plugin:action:disabled': [payload: { id: string; workspaceId: string }];
    'admin.user:action:role_changed': [
        payload: { workspaceId: string; userId: string; role: 'owner' | 'editor' | 'viewer' }
    ];
}

export type AdminActionHookName = AdminHookKey;

type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : [];

export type InferAdminHookCallback<K extends AdminActionHookName> = (
    ...args: AdminHookPayloadMap[K]
) => unknown;

export type InferAdminHookParams<K extends AdminActionHookName> = AdminHookPayloadMap[K];

export type InferAdminHookReturn<K extends AdminActionHookName> =
    AdminHookPayloadMap[K] extends [infer R, ...Tail<AdminHookPayloadMap[K]>] ? R : never;
