/**
 * @module app/utils/capability-guards
 *
 * Purpose:
 * Enforces plugin capability gates for actions that are exposed to plugins.
 *
 * Behavior:
 * - When no plugin context is active, guards allow the operation
 * - When a plugin context is active, guards verify capabilities and show
 *   a toast on denial
 *
 * Constraints:
 * - These guards are UI-level enforcement and do not replace server checks
 * - Active plugin context is stored on `globalThis`
 */

import {
    hasCapability,
    hasAnyCapability,
} from '~/composables/dashboard/useDashboardPlugins';
import { useToast } from '#imports';
import { reportError, err } from './errors';

type ToastInput = Parameters<ReturnType<typeof useToast>['add']>[0];

/**
 * `guardCapability`
 *
 * Purpose:
 * Verifies that the active plugin has the required capability.
 *
 * Behavior:
 * - Returns `true` when no plugin context is active
 * - Shows a toast and reports an error when denied
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

        const toastPayload: ToastInput = {
            title: 'Permission Denied',
            description: `This plugin cannot perform "${operation}" (missing capability: ${capability})`,
            color: 'error',
            duration: 5000,
        };

        toast.add(toastPayload);

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
 * `guardAllCapabilities`
 *
 * Purpose:
 * Requires a plugin to have all listed capabilities.
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
 * `guardAnyCapability`
 *
 * Purpose:
 * Requires a plugin to have at least one of the listed capabilities.
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

        const toastPayload: ToastInput = {
            title: 'Permission Denied',
            description: `This plugin cannot perform "${operation}"`,
            color: 'error',
            duration: 5000,
        };

        toast.add(toastPayload);

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
 * `setPluginContext`
 *
 * Purpose:
 * Sets the active plugin context used by capability guards.
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
 * `clearPluginContext`
 *
 * Purpose:
 * Clears the active plugin context.
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
 * `getActivePluginId`
 *
 * Purpose:
 * Returns the currently active plugin ID or `null`.
 */
export function getActivePluginId(): string | null {
    const g = globalThis as typeof globalThis & {
        __or3ActivePluginContext?: { pluginId: string | null };
    };
    return g.__or3ActivePluginContext?.pluginId || null;
}
