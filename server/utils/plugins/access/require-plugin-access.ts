import type { H3Event } from 'h3';
import { createError } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';
import {
    evaluatePluginGate,
    mergePluginGatePolicy,
    type PluginGateDecision,
    type PluginGatePolicy,
} from '~~/shared/plugins/access-policy';
import { resolveSessionContext } from '../../../auth/session';
import { resolveEntitlements } from '../../../auth/entitlements/registry';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import {
    getEnabledPlugins,
    getPluginSettings,
    readPluginAccessPolicy,
} from '../../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';

export interface PluginAccessContext {
    pluginId: string;
    action?: string;
}

export interface PluginAccessCheckResult {
    session: SessionContext;
    decision: PluginGateDecision;
}

async function getPluginDefaults(
    event: H3Event,
    pluginId: string
): Promise<PluginGatePolicy | null> {
    const cacheKey = '__or3_plugin_defaults_manifest';
    const cached = event.context[cacheKey] as Map<string, PluginGatePolicy | null> | undefined;
    if (cached?.has(pluginId)) {
        return cached.get(pluginId) ?? null;
    }

    const map = cached ?? new Map<string, PluginGatePolicy | null>();
    if (!cached) {
        event.context[cacheKey] = map;
    }

    const installed = await listInstalledExtensions();
    const plugin = installed.find(
        (entry) => entry.kind === 'plugin' && entry.id === pluginId
    );
    const defaults = (plugin?.access ?? null) as PluginGatePolicy | null;
    map.set(pluginId, defaults);
    return defaults;
}

export async function checkPluginAccess(
    event: H3Event,
    context: PluginAccessContext
): Promise<PluginAccessCheckResult> {
    const session = await resolveSessionContext(event);
    const workspaceId = session.workspace?.id;

    let pluginEnabled = true;
    let adminPolicy: PluginGatePolicy | null = null;

    if (workspaceId) {
        const settingsStore = getWorkspaceSettingsStore(event);
        const [enabled, settings] = await Promise.all([
            getEnabledPlugins(settingsStore, workspaceId),
            getPluginSettings(settingsStore, workspaceId, context.pluginId),
        ]);
        pluginEnabled = enabled.includes(context.pluginId);
        adminPolicy = readPluginAccessPolicy(settings);
    }

    const pluginDefaults = await getPluginDefaults(event, context.pluginId);
    const effectivePolicy = mergePluginGatePolicy(pluginDefaults, adminPolicy);
    const entitlements = await resolveEntitlements(event, session);

    const decision = evaluatePluginGate({
        policy: effectivePolicy,
        session: {
            authenticated: session.authenticated,
            role: session.role,
        },
        entitlements,
        pluginEnabled,
    });

    return { session, decision };
}

export async function requirePluginAccess(
    event: H3Event,
    context: PluginAccessContext
): Promise<PluginAccessCheckResult> {
    const result = await checkPluginAccess(event, context);
    if (result.decision.allowed) {
        return result;
    }

    const reason = result.decision.reasons[0] ?? 'forbidden';
    const unauthenticated = result.decision.reasons.includes('unauthenticated');
    throw createError({
        statusCode: unauthenticated ? 401 : 403,
        statusMessage: unauthenticated ? 'Unauthorized' : 'Forbidden',
        data: {
            pluginId: context.pluginId,
            action: context.action,
            reason,
            reasons: result.decision.reasons,
        },
    });
}