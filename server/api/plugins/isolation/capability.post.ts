/**
 * Authenticated capability bridge for portable plugins.
 *
 * Server-owned capabilities (governed model calls, approved connection
 * dispatch) cannot be instantiated in a browser bundle, so the sandbox reaches
 * them through this endpoint.
 *
 * What makes it trustworthy:
 * - The caller must have an authenticated SSR session in the active workspace
 *   with `workspace.write`, and pass the same-origin mutation guard.
 * - The plugin, workspace, user, owner and credential are derived here from the
 *   session and server records. Nothing the sandbox sends is treated as
 *   authority; `pluginId`/`generation` are checked against installed and
 *   enabled plugin state.
 * - Only the approved capability methods are dispatchable, and each one keeps
 *   its own policy: `ai.complete` runs through the governed AI path (model
 *   allowlist, output ceiling, reserved spend), `connections.dispatch` through
 *   the release's approved connection authority.
 *
 * Every refusal is a structured 4xx/403 with the reason, never a silent success.
 */

import { createError, defineEventHandler } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { getEnabledPlugins } from '../../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { checkPluginAccess } from '../../../utils/plugins/access/require-plugin-access';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { requirePluginMutation } from '../../../utils/plugins/connections/api-context';
import { resolveConnectionService } from '../../../utils/plugins/connections/resolve';
import { listConnectionProviders } from '../../../utils/plugins/connections/providers/registry';
import { createFetchConnectionTransport } from '../../../utils/plugins/connections/transport';
import { dispatchApprovedConnectionOperation } from '../../../utils/plugins/connections/dispatch';
import {
    loadPackageDescriptors,
    toConnectionDispatchPolicy,
} from '../../../utils/plugins/setup/load-descriptors';
import {
    createPluginAiCompleteMethod,
    PLUGIN_AI_COMPLETE_METHOD,
} from '../../../utils/plugins/ai/plugin-invocation';
import { createOpenRouterPluginProvider } from '../../../utils/plugins/ai/openrouter-client';
import { CONNECTIONS_DISPATCH_METHOD } from '../../../utils/plugins/connections/broker-binding';
import { DEFAULT_CONTAINMENT_BUDGETS } from '~~/shared/plugins/isolation/budgets';
import type { HostRpcHandlerContext } from '~~/shared/plugins/isolation/host-rpc-broker';

type CapabilityBody = {
    readonly pluginId?: unknown;
    readonly generation?: unknown;
    readonly method?: unknown;
    readonly params?: unknown;
    readonly requestId?: unknown;
};

/**
 * Host-side AI governors, one per activation. Spend accounting must survive
 * individual HTTP requests, otherwise a plugin could reset its budget by
 * calling again.
 */
const aiGovernors = new Map<string, ReturnType<typeof createPluginAiCompleteMethod>>();

function governorFor(key: string, factory: () => ReturnType<typeof createPluginAiCompleteMethod>) {
    const existing = aiGovernors.get(key);
    if (existing) return existing;
    const created = factory();
    aiGovernors.set(key, created);
    // Bounded map: activations are short-lived and keyed by generation.
    if (aiGovernors.size > 256) {
        const oldest = aiGovernors.keys().next().value;
        if (typeof oldest === 'string') aiGovernors.delete(oldest);
    }
    return created;
}

export default defineEventHandler(async (event) => {
    requirePluginMutation(event);
    const config = useRuntimeConfig();
    if (!config.auth.enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const session = await resolveSessionContext(event);
    requireSession(session);
    const workspaceId = session.workspace?.id;
    const userId = session.user?.id;
    if (!workspaceId || !userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.write', { kind: 'workspace', id: workspaceId });

    const body = await readLimitedJsonBody<CapabilityBody | undefined>(event);
    const pluginId = typeof body?.pluginId === 'string' ? body.pluginId.trim() : '';
    const method = typeof body?.method === 'string' ? body.method : '';
    const generation =
        typeof body?.generation === 'number' && Number.isInteger(body.generation)
            ? body.generation
            : null;
    const params =
        body?.params && typeof body.params === 'object' && !Array.isArray(body.params)
            ? (body.params as Readonly<Record<string, unknown>>)
            : {};
    const requestId =
        typeof body?.requestId === 'string' && body.requestId.length <= 128
            ? body.requestId
            : `cap-${Date.now().toString(36)}`;

    if (!pluginId || pluginId.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'pluginId is required' });
    }
    if (generation === null) {
        throw createError({ statusCode: 400, statusMessage: 'generation is required' });
    }

    // The plugin must be installed and enabled for this workspace, and must pass
    // the workspace's own access gate. The sandbox's claim is only a lookup key.
    const installed = (await listInstalledExtensions()).find(
        (extension) => extension.kind === 'plugin' && extension.id === pluginId
    );
    if (installed) {
        const enabled = await getEnabledPlugins(getWorkspaceSettingsStore(event), workspaceId);
        if (!enabled.includes(pluginId)) {
            throw createError({ statusCode: 403, statusMessage: 'Plugin is not enabled' });
        }
    }
    const access = await checkPluginAccess(event, { pluginId, action: 'use' });
    if (!access.decision.allowed) {
        throw createError({
            statusCode: 403,
            statusMessage: `Plugin access denied (${access.decision.reasons.join(', ')})`,
        });
    }

    const context: HostRpcHandlerContext = {
        pluginId,
        workspaceId,
        userId,
        generation,
        requestId,
        signal: new AbortController().signal,
        deadlineMs: DEFAULT_CONTAINMENT_BUDGETS.defaultCallDeadlineMs,
    };

    if (method === PLUGIN_AI_COMPLETE_METHOD) {
        const apiKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY || '';
        if (!apiKey) {
            throw createError({
                statusCode: 503,
                statusMessage: 'No host model provider credential is configured',
            });
        }
        const spec = governorFor(`${userId}:${workspaceId}:${pluginId}:${generation}`, () =>
            createPluginAiCompleteMethod({
                provider: createOpenRouterPluginProvider({
                    apiKey,
                    baseUrl: config.openrouterBaseUrl || 'https://openrouter.ai/api/v1',
                    prices: resolveHostModelPrices(config),
                }),
                prices: resolveHostModelPrices(config),
                allowedModels: resolveAllowedModels(config),
            })
        );
        try {
            const result = await spec.handler(params, context);
            return { ok: true, result };
        } catch (error) {
            throw asCapabilityError(error);
        }
    }

    if (method === CONNECTIONS_DISPATCH_METHOD) {
        const service = resolveConnectionService();
        if (!service.durable) {
            // A non-durable store would not have the connection this call refers to.
            throw createError({
                statusCode: 503,
                statusMessage: 'No durable connection store is configured',
            });
        }
        const ref = typeof params.ref === 'string' ? params.ref : '';
        const operationId = typeof params.operationId === 'string' ? params.operationId : '';
        const url = typeof params.url === 'string' ? params.url : '';
        if (!ref || !operationId || !url) {
            throw createError({
                statusCode: 400,
                statusMessage: 'ref, operationId and url are required',
            });
        }
        const resolved = await service.service.resolve({
            ref,
            pluginId,
            workspaceId,
            ownerUserId: userId,
        });
        if (resolved.status === 'denied') {
            throw createError({ statusCode: 403, statusMessage: resolved.message });
        }
        const provider = listConnectionProviders().find(
            (candidate) => candidate.id === resolved.connection.providerId
        );
        if (!provider) {
            throw createError({ statusCode: 400, statusMessage: 'Unknown connection provider' });
        }

        let policy = null;
        if (installed) {
            const descriptors = await loadPackageDescriptors({
                extensionsBaseDir: EXTENSIONS_BASE_DIR,
                packagePath: installed.path,
            });
            policy = toConnectionDispatchPolicy(descriptors.policy);
        }

        const credential = service.service.revealCredential(resolved.connection);
        if (credential === null) {
            throw createError({ statusCode: 503, statusMessage: 'Connection credential is unavailable' });
        }

        const outcome = await dispatchApprovedConnectionOperation({
            provider,
            operationId,
            url,
            ...(typeof params.method === 'string' ? { method: params.method } : {}),
            ...(params.headers && typeof params.headers === 'object' && !Array.isArray(params.headers)
                ? { headers: params.headers as Readonly<Record<string, string>> }
                : {}),
            ...(typeof params.body === 'string' ? { body: params.body } : {}),
            grantedScopes: resolved.connection.scopes,
            credential,
            policy,
            pluginId,
            workspaceId,
            generation,
            transport: createFetchConnectionTransport(),
            timeoutMs: context.deadlineMs,
        });
        if (outcome.status === 'denied') {
            throw createError({ statusCode: 403, statusMessage: outcome.message });
        }
        if (outcome.status === 'failed') {
            return {
                ok: true,
                result: {
                    ok: false,
                    operationId: outcome.operationId,
                    code: outcome.code,
                    message: outcome.message,
                },
            };
        }
        return {
            ok: true,
            result: { ok: true, operationId: outcome.operationId, response: outcome.response },
        };
    }

    throw createError({
        statusCode: 400,
        statusMessage: `Unknown capability method: ${method}`,
    });
});

/**
 * Trusted model prices. The host configuration supplies them; a model without a
 * configured price is refused by the governor rather than treated as free.
 */
function resolveHostModelPrices(config: unknown): Record<
    string,
    { promptPerMillion: number; completionPerMillion: number }
> {
    const admin = (config as { admin?: { pluginModelPrices?: unknown } }).admin;
    const raw = admin?.pluginModelPrices;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const prices: Record<string, { promptPerMillion: number; completionPerMillion: number }> = {};
    for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const entry = value as { promptPerMillion?: unknown; completionPerMillion?: unknown };
        const prompt = Number(entry.promptPerMillion);
        const completion = Number(entry.completionPerMillion);
        if (!Number.isFinite(prompt) || !Number.isFinite(completion)) continue;
        if (prompt < 0 || completion < 0) continue;
        prices[model] = { promptPerMillion: prompt, completionPerMillion: completion };
    }
    return prices;
}

/** Allowlist of models plugins may use; empty means the host has none approved. */
function resolveAllowedModels(config: unknown): string[] {
    const admin = (config as { admin?: { pluginAllowedModels?: unknown } }).admin;
    const raw = admin?.pluginAllowedModels;
    if (!Array.isArray(raw)) return [];
    return raw.filter((value): value is string => typeof value === 'string');
}

function asCapabilityError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Capability call failed';
    const rpcCode =
        typeof error === 'object' && error !== null && 'rpcCode' in error
            ? (error as { rpcCode?: unknown }).rpcCode
            : undefined;
    const statusCode =
        rpcCode === 'budget-exceeded'
            ? 429
            : rpcCode === 'cancelled'
              ? 499
              : rpcCode === 'deadline-exceeded'
                ? 504
                : 403;
    return createError({ statusCode, statusMessage: message, data: { rpcCode: rpcCode ?? 'internal' } });
}
