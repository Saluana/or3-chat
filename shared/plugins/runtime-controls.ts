import type { Sha256 } from './runtime-descriptor';

/**
 * Operator controls for Plugin Runtime V2 admin surfaces.
 * Each control either invokes a real manager/package operation or explains
 * why it is unavailable for the current scope/flags.
 */

export type RuntimeControlId =
    | 'retry'
    | 'quarantine-clear'
    | 'disable'
    | 'inspect'
    | 'rollback'
    | 'safe-mode-guidance';

export type RuntimeControlScope =
    | 'this-client'
    | 'this-server-process'
    | 'persisted-package-state'
    | 'operator-env';

export type RuntimeControlAvailability =
    | { readonly available: true; readonly reason?: string }
    | { readonly available: false; readonly reason: string };

export interface RuntimeControlDescriptor {
    readonly id: RuntimeControlId;
    readonly label: string;
    readonly description: string;
    readonly scope: RuntimeControlScope;
    readonly availability: RuntimeControlAvailability;
}

export interface RuntimeManagerControlSurface {
    listRecords(): readonly {
        readonly descriptor: { readonly id: string; readonly descriptorKey: Sha256 };
        readonly status: string;
        readonly nextRetryAt?: number;
        readonly quarantinedDescriptorKey?: Sha256;
    }[];
    retry(descriptorKey: Sha256): boolean;
    schedule(trigger: string): Promise<void>;
}

export interface RuntimeControlContext {
    readonly managerV2Enabled: boolean;
    readonly safeModeEnabled: boolean;
    readonly manager?: RuntimeManagerControlSurface | null;
    readonly descriptorKey?: Sha256;
}

export type RuntimeControlResult =
    | {
          readonly status: 'ok';
          readonly controlId: RuntimeControlId;
          readonly message: string;
          readonly detail?: unknown;
      }
    | {
          readonly status: 'unavailable';
          readonly controlId: RuntimeControlId;
          readonly message: string;
      }
    | {
          readonly status: 'failed';
          readonly controlId: RuntimeControlId;
          readonly message: string;
          readonly detail?: unknown;
      };

const SAFE_MODE_GUIDANCE = Object.freeze([
    'Set OR3_DISABLE_NON_CORE_PLUGINS=true (or admin.disableNonCorePlugins) outside the plugin UI.',
    'Restart the OR3 process before plugin discovery so non-core plugins never import.',
    'Confirm Runtime Inspector reports Safe mode: enabled on this client.',
    'Recovery does not delete package digests, settings, or migrated state; disable/uninstall/data deletion remain separate.',
    'Activation is not fleet-atomic: other clients/processes keep their prior generation until they restart or reconcile.',
] as const);

function availability(
    available: boolean,
    reason: string
): RuntimeControlAvailability {
    return available
        ? { available: true, reason }
        : { available: false, reason };
}

function findRecord(
    context: RuntimeControlContext,
    descriptorKey: Sha256 | undefined
) {
    if (!context.manager || !descriptorKey) return undefined;
    return context.manager
        .listRecords()
        .find((record) => record.descriptor.descriptorKey === descriptorKey);
}

/** Catalog of controls with per-context availability. */
export function listRuntimeControls(
    context: RuntimeControlContext
): readonly RuntimeControlDescriptor[] {
    const hasManager = context.managerV2Enabled && !!context.manager;
    const hasDescriptor = typeof context.descriptorKey === 'string';

    return Object.freeze([
        {
            id: 'retry',
            label: 'Retry',
            description:
                'Clear in-session failure/backoff for a descriptor key and schedule reconciliation.',
            scope: 'this-client',
            availability: availability(
                hasManager && hasDescriptor,
                hasManager
                    ? hasDescriptor
                        ? 'Calls BundledV1PluginManager.retry then schedule.'
                        : 'Select a descriptor key to retry.'
                    : 'Unavailable until OR3_PLUGIN_RUNTIME_V2_ENABLED selects the manager and this client owns records.'
            ),
        },
        {
            id: 'quarantine-clear',
            label: 'Clear quarantine',
            description:
                'Clear quarantined failure state for a descriptor key (same manager operation as retry).',
            scope: 'this-client',
            availability: availability(
                hasManager && hasDescriptor,
                hasManager
                    ? hasDescriptor
                        ? 'Calls BundledV1PluginManager.retry (quarantine clears by descriptor key).'
                        : 'Select a quarantined descriptor key.'
                    : 'Unavailable without the V2 manager on this client.'
            ),
        },
        {
            id: 'disable',
            label: 'Disable',
            description:
                'Disable a plugin for a workspace without deleting packages, settings, or migrated state.',
            scope: 'persisted-package-state',
            availability: availability(
                false,
                'Requires server package lifecycle + workspaceId + pluginId. Client shadow mode cannot persist disable.'
            ),
        },
        {
            id: 'inspect',
            label: 'Inspect',
            description:
                'Show descriptor/artifact identity, desired versus actual status, and retry/quarantine fields for this scope.',
            scope: 'this-client',
            availability: availability(
                true,
                hasManager
                    ? 'Reads manager/shadow records for this client only (not fleet-wide).'
                    : 'Inspector remains available; manager records require V2 startup selection.'
            ),
        },
        {
            id: 'rollback',
            label: 'Rollback package pointer',
            description:
                'Roll the persisted package pointer to previous when state preflight allows; never claims incompatible migrated state was restored.',
            scope: 'persisted-package-state',
            availability: availability(
                false,
                'Requires server promotion service, pluginId, and snapshot/restore adapters. Not available from client-only shadow mode.'
            ),
        },
        {
            id: 'safe-mode-guidance',
            label: 'Safe-mode guidance',
            description:
                'Operator steps to recover without the plugin UI via startup-only safe mode.',
            scope: 'operator-env',
            availability: availability(
                true,
                context.safeModeEnabled
                    ? 'Safe mode is already enabled for this process lifetime.'
                    : 'Safe mode is startup-only; follow env + restart guidance.'
            ),
        },
    ]);
}

export async function executeRuntimeControl(
    controlId: RuntimeControlId,
    context: RuntimeControlContext
): Promise<RuntimeControlResult> {
    const control = listRuntimeControls(context).find((entry) => entry.id === controlId);
    if (!control) {
        return {
            status: 'unavailable',
            controlId,
            message: `Unknown control: ${controlId}`,
        };
    }
    if (!control.availability.available) {
        return {
            status: 'unavailable',
            controlId,
            message: control.availability.reason,
        };
    }

    switch (controlId) {
        case 'retry':
        case 'quarantine-clear': {
            const key = context.descriptorKey;
            if (!context.manager || !key) {
                return {
                    status: 'unavailable',
                    controlId,
                    message: 'Manager and descriptorKey are required.',
                };
            }
            const cleared = context.manager.retry(key);
            await context.manager.schedule(
                controlId === 'retry' ? 'runtime-control:retry' : 'runtime-control:quarantine-clear'
            );
            const record = findRecord(context, key);
            return {
                status: 'ok',
                controlId,
                message: cleared
                    ? `Cleared failure state for ${key} and scheduled reconcile.`
                    : `No prior failure entry for ${key}; scheduled reconcile anyway.`,
                detail: { cleared, status: record?.status },
            };
        }
        case 'inspect': {
            const records = context.manager?.listRecords() ?? [];
            const selected = context.descriptorKey
                ? records.filter(
                      (record) => record.descriptor.descriptorKey === context.descriptorKey
                  )
                : records;
            return {
                status: 'ok',
                controlId,
                message: `Inspected ${selected.length} record(s) for this client scope.`,
                detail: Object.freeze({
                    scope: 'this-client' as const,
                    fleetWide: false,
                    safeModeEnabled: context.safeModeEnabled,
                    managerV2Enabled: context.managerV2Enabled,
                    records: selected.map((record) =>
                        Object.freeze({
                            pluginId: record.descriptor.id,
                            descriptorKey: record.descriptor.descriptorKey,
                            status: record.status,
                            nextRetryAt: record.nextRetryAt,
                            quarantinedDescriptorKey: record.quarantinedDescriptorKey,
                        })
                    ),
                }),
            };
        }
        case 'disable':
        case 'rollback': {
            return {
                status: 'unavailable',
                controlId,
                message: control.availability.reason ?? control.description,
            };
        }
        case 'safe-mode-guidance': {
            return {
                status: 'ok',
                controlId,
                message: context.safeModeEnabled
                    ? 'Safe mode is enabled for this process. Keep non-core discovery off until recovery is complete.'
                    : 'Follow startup-only safe-mode steps outside the plugin UI.',
                detail: Object.freeze({
                    safeModeEnabled: context.safeModeEnabled,
                    steps: SAFE_MODE_GUIDANCE,
                    limitations: Object.freeze([
                        'trusted-host grants are not a sandbox',
                        'activation is not fleet-atomic',
                        'disable retains packages and host-managed data until explicit deletion',
                    ]),
                }),
            };
        }
        default: {
            const _exhaustive: never = controlId;
            return {
                status: 'unavailable',
                controlId: _exhaustive,
                message: `Unhandled control: ${String(_exhaustive)}`,
            };
        }
    }
}
