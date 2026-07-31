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
    /**
     * Host-resolved extension metadata for package runtimes that do not live in
     * the legacy extension inventory. Supplying this opts into the same
     * workspace enabled-list and manifest-default checks as V1 extensions.
     */
    extension?: {
        access?: PluginGatePolicy | null;
    };
}

export interface PluginAccessCheckResult {
    session: SessionContext;
    decision: PluginGateDecision;
}

interface PluginManifestAccess {
    exists: boolean;
    defaults: PluginGatePolicy | null;
}

async function getPluginManifestAccess(
    event: H3Event,
    pluginId: string
): Promise<PluginManifestAccess> {
    const cacheKey = '__or3_plugin_defaults_manifest';
    const cached = event.context[cacheKey] as Map<string, PluginManifestAccess> | undefined;
    if (cached?.has(pluginId)) {
        return (
            cached.get(pluginId) ?? {
                exists: false,
                defaults: null,
            }
        );
    }

    const map = cached ?? new Map<string, PluginManifestAccess>();
    if (!cached) {
        event.context[cacheKey] = map;
    }

    const installed = await listInstalledExtensions();
    const plugin = installed.find(
        (entry) => entry.kind === 'plugin' && entry.id === pluginId
    );
    const entry: PluginManifestAccess = {
        exists: Boolean(plugin),
        defaults: (plugin?.access ?? null) as PluginGatePolicy | null,
    };
    map.set(pluginId, entry);
    return entry;
}

export async function checkPluginAccess(
    event: H3Event,
    context: PluginAccessContext
): Promise<PluginAccessCheckResult> {
    const session = await resolveSessionContext(event);
    const workspaceId = session.workspace?.id;
    const manifestAccess = context.extension
        ? {
              exists: true,
              defaults: context.extension.access ?? null,
          }
        : await getPluginManifestAccess(event, context.pluginId);

    let pluginEnabled = true;
    let adminPolicy: PluginGatePolicy | null = null;

    if (workspaceId) {
        const settingsStore = getWorkspaceSettingsStore(event);
        if (manifestAccess.exists) {
            const [enabled, settings] = await Promise.all([
                getEnabledPlugins(settingsStore, workspaceId),
                getPluginSettings(settingsStore, workspaceId, context.pluginId),
            ]);
            pluginEnabled = enabled.includes(context.pluginId);
            adminPolicy = readPluginAccessPolicy(settings);
        } else {
            // Built-in/non-extension plugin ids are not controlled by the
            // workspace enabled-plugins list.
            const settings = await getPluginSettings(
                settingsStore,
                workspaceId,
                context.pluginId
            );
            adminPolicy = readPluginAccessPolicy(settings);
        }
    }

    const effectivePolicy = mergePluginGatePolicy(
        manifestAccess.defaults,
        adminPolicy
    );
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
