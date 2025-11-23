import {
    hasCapability,
    hasAnyCapability,
} from '~/composables/dashboard/useDashboardPlugins';
import { useToast } from '#imports';
import { reportError, err } from './errors';

/**
 * Guard function to check if the current plugin context has the required capability.
 * If no plugin context is present, the operation is allowed (no gating for non-plugin code).
 * If a plugin context is present but lacks the capability, the operation is blocked.
 *
 * @param capability - The required capability string
 * @param operation - Human-readable name of the operation being guarded
 * @returns true if allowed, false if blocked
 */
export function guardCapability(
    capability: string,
    operation: string
): boolean {
    // Check for active plugin context (set by pane plugin API or dashboard handlers)
    const g = globalThis as typeof globalThis & {
        __or3ActivePluginContext?: { pluginId: string | null };
    };
    const activePluginId = g.__or3ActivePluginContext?.pluginId;

    // If no plugin context, allow operation (native app code)
    if (!activePluginId) return true;

    // Check if plugin has the required capability
    const allowed = hasCapability(activePluginId, capability);

    if (!allowed) {
        const message = `Plugin "${activePluginId}" lacks required capability: ${capability}`;
        const toast = useToast();

        if (toast?.add) {
            toast.add({
                title: 'Permission Denied',
                description: `This plugin cannot perform "${operation}" (missing capability: ${capability})`,
                color: 'error',
                timeout: 5000,
            } as any);
        }

        reportError(
            err('ERR_INTERNAL', message, {
                tags: {
                    domain: 'capabilities',
                    pluginId: activePluginId,
                    capability,
                    operation,
                },
            }),
            { silent: true, code: 'ERR_INTERNAL' }
        );
    }

    return allowed;
}

/**
 * Guard function that checks multiple capabilities (plugin must have ALL of them).
 */
export function guardAllCapabilities(
    capabilities: string[],
    operation: string
): boolean {
    const g = globalThis as typeof globalThis & {
        __or3ActivePluginContext?: { pluginId: string | null };
    };
    const activePluginId = g.__or3ActivePluginContext?.pluginId;

    if (!activePluginId) return true;

    for (const cap of capabilities) {
        if (!guardCapability(cap, operation)) return false;
    }

    return true;
}

/**
 * Guard function that checks multiple capabilities (plugin must have ANY of them).
 */
export function guardAnyCapability(
    capabilities: string[],
    operation: string
): boolean {
    const g = globalThis as typeof globalThis & {
        __or3ActivePluginContext?: { pluginId: string | null };
    };
    const activePluginId = g.__or3ActivePluginContext?.pluginId;

    if (!activePluginId) return true;

    const allowed = hasAnyCapability(activePluginId, capabilities);

    if (!allowed) {
        const message = `Plugin "${activePluginId}" lacks any of required capabilities: ${capabilities.join(
            ', '
        )}`;
        const toast = useToast();

        if (toast?.add) {
            toast.add({
                title: 'Permission Denied',
                description: `This plugin cannot perform "${operation}"`,
                color: 'error',
                timeout: 5000,
            } as any);
        }

        reportError(
            err('ERR_INTERNAL', message, {
                tags: {
                    domain: 'capabilities',
                    pluginId: activePluginId,
                    capabilities: capabilities.join(','),
                    operation,
                },
            }),
            { silent: true, code: 'ERR_INTERNAL' }
        );
    }

    return allowed;
}

/**
 * Set the active plugin context for capability checking.
 * This should be called when entering plugin code execution.
 */
export function setPluginContext(pluginId: string | null) {
    const g = globalThis as typeof globalThis & {
        __or3ActivePluginContext?: { pluginId: string | null };
    };
    if (!g.__or3ActivePluginContext) {
        g.__or3ActivePluginContext = { pluginId: null };
    }
    g.__or3ActivePluginContext.pluginId = pluginId;
}

/**
 * Clear the active plugin context.
 */
export function clearPluginContext() {
    const g = globalThis as typeof globalThis & {
        __or3ActivePluginContext?: { pluginId: string | null };
    };
    if (g.__or3ActivePluginContext) {
        g.__or3ActivePluginContext.pluginId = null;
    }
}

/**
 * Get the current active plugin ID if any.
 */
export function getActivePluginId(): string | null {
    const g = globalThis as typeof globalThis & {
        __or3ActivePluginContext?: { pluginId: string | null };
    };
    return g.__or3ActivePluginContext?.pluginId || null;
}
