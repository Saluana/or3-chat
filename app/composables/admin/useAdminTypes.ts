/**
 * Shared type definitions for admin API responses.
 * Consolidates common types from index.vue and system.vue.
 */

export type ProviderStatus = {
    enabled: boolean;
    provider: string;
    details?: Record<string, unknown>;
    actions?: ProviderAction[];
};

export type ProviderAction = {
    id: string;
    label: string;
    description?: string;
    danger?: boolean;
};

export type SystemStatus = {
    auth: ProviderStatus;
    sync: ProviderStatus;
    storage: ProviderStatus;
    backgroundStreaming: { enabled: boolean; storageProvider: string };
    admin?: { allowRestart: boolean; allowRebuild: boolean };
};

export type StatusResponse = {
    status: SystemStatus;
    warnings: Array<{ level: 'warning' | 'error'; message: string }>;
    session?: { role?: string };
};

export type ConfigEntry = {
    key: string;
    value: string | null;
    masked: boolean;
};

export type EnrichedConfigEntry = ConfigEntry & {
    label: string;
    description: string;
    group: ConfigGroup;
    order: number;
    valueType: 'string' | 'boolean' | 'number';
};

export type ConfigGroup =
    | 'Auth'
    | 'Sync'
    | 'Storage'
    | 'UI & Branding'
    | 'Features'
    | 'Limits & Security'
    | 'Background Processing'
    | 'Admin'
    | 'External Services';

export type WorkspaceResponse = {
    workspace: { id: string; name: string };
    role: string;
    members: Array<{ userId: string; email?: string; role: string }>;
    enabledPlugins: string[];
    guestAccessEnabled: boolean;
};
