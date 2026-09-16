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

export type DashboardUpdateJob = {
    id: string;
    targetVersion: string;
    phase: 'queued' | 'running' | 'succeeded' | 'failed' | 'needs_attention';
    startedAt: string;
    completedAt?: string;
    error?: string;
};

export type DashboardUpdateReceipt = {
    schemaVersion: 1;
    warnings?: Array<{ code: string; message: string }>;
    checks?: Array<{ code: string; status: string; detail: string }>;
    operatorHandoff?: string;
};

export type DashboardUpdateStatus =
    | {
          kind: 'managed';
          enabled: true;
          protocolVersion?: 2;
          currentVersion: string | null;
          checkedAt?: string;
          latestVersion?: string;
          updateAvailable?: boolean;
          checkError?: string;
          incompatibilityReason?: string;
          job: DashboardUpdateJob | null;
          receipt?: DashboardUpdateReceipt;
      }
    | {
          kind: 'unsupported' | 'unavailable';
          enabled: false;
          reason: string;
      };

export type DashboardUpdatePreview = {
    protocolVersion: 2;
    preview: {
        version: string;
        assessment: {
            schemaVersion: number;
            observedAt: string;
            target: { appVersion: string; imageDigest: string };
            checks: Array<{ code: string; status: 'passed' | 'failed' | 'deferred' | 'unknown'; detail: string }>;
            findings: Array<{ code: string; severity: 'blocker' | 'warning' | 'info'; message: string; nextCommand?: string }>;
            retention: { keep: string[]; remove: string[]; preserve: Array<{ entryName: string; reason: string }>; canPrune: boolean };
            stateFingerprint: string;
        };
    };
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
