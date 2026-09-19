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
 * - The request carries an opaque activation handle minted by
 *   `POST /api/plugins/isolation/activation`. The plugin, workspace, user,
 *   generation, package digest and approved grants are read from that sealed
 *   record — nothing the sandbox sends is treated as authority. A handle that
 *   is unknown, expired, revoked, bound to another session, or whose selected
 *   package changed is refused (and stale handles are revoked) before any
 *   method runs.
 * - Every method is dispatched through the host RPC broker, so grant, replay,
 *   backpressure, deadline and abort enforcement are the same code path the
 *   in-page bridge uses. A disconnected client aborts the in-flight handler.
 *
 * Every refusal is a structured 4xx/5xx with the reason, never a silent success.
 */

import { createError, defineEventHandler, type H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import {
    getEnabledPlugins,
    getPluginGrantReview,
} from '../../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import {
    packageGrantCandidate,
    readPackageManifest,
} from '../../../admin/plugins/package-operation-support';
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
import {
    readPersistentPluginAiBudget,
    reservePersistentPluginAiSpend,
    settlePersistentPluginAiSpend,
} from '../../../utils/plugins/ai/persistent-budget-ledger';
import { buildPluginModelCatalog } from '~~/shared/plugins/ai/model-catalog';
import {
    resolveAllowedModels,
    resolveHostModelPrices,
} from '../../../utils/plugins/ai/model-catalog';
import { createOpenRouterPluginProvider } from '../../../utils/plugins/ai/openrouter-client';
import { CONNECTIONS_DISPATCH_METHOD } from '../../../utils/plugins/connections/broker-binding';
import { REMOTE_CAPABILITY_METHODS } from '~~/shared/plugins/isolation/capability-bridge';
import { DEFAULT_CONTAINMENT_BUDGETS } from '~~/shared/plugins/isolation/budgets';
import {
    HostRpcBroker,
    type HostRpcHandlerContext,
    type HostRpcMethodSpec,
} from '~~/shared/plugins/isolation/host-rpc-broker';
import {
    RPC_ENVELOPE_VERSION,
    type RpcEnvelope,
} from '~~/shared/plugins/isolation/rpc-envelope';
import {
    resolveHostActivation,
    revokeHostActivation,
    type HostActivationRecord,
} from '../../../utils/plugins/isolation/activation-registry';
import { resolvePluginPackage } from '../../../utils/plugins/setup/discovery';

/** Capability method that discloses the approved models (phase 9). */
const AI_MODELS_METHOD = REMOTE_CAPABILITY_METHODS.aiModels;

type CapabilityBody = {
    readonly activationId?: unknown;
    readonly method?: unknown;
    readonly params?: unknown;
    readonly requestId?: unknown;
    readonly deadlineMs?: unknown;
};

/** Retained for callers that reset the old in-process governor test state. */
export function clearCapabilityGovernorsForTests(): void {
    // AI spend is persisted by the active settings provider; there is no
    // process-local cache to clear.
    return undefined;
}

/** Abort in-flight work when the client goes away before the response lands. */
function abortOnDisconnect(event: H3Event, onAbort: () => void): () => void {
    const res = (
        event.node as {
            readonly res?: {
                on: (name: string, listener: () => void) => void;
                off: (name: string, listener: () => void) => void;
                writableEnded?: boolean;
            };
        }
    ).res;
    if (!res) return () => undefined;
    const listener = () => {
        if (!res.writableEnded) onAbort();
    };
    res.on('close', listener);
    return () => res.off('close', listener);
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
    const activationId = typeof body?.activationId === 'string' ? body.activationId.trim() : '';
    const method = typeof body?.method === 'string' ? body.method : '';
    const params =
        body?.params && typeof body.params === 'object' && !Array.isArray(body.params)
            ? (body.params as Readonly<Record<string, unknown>>)
            : {};
    const requestId =
        typeof body?.requestId === 'string' && body.requestId.length <= 128
            ? body.requestId
            : `cap-${Date.now().toString(36)}`;
    const requestedDeadline =
        typeof body?.deadlineMs === 'number' && Number.isFinite(body.deadlineMs)
            ? body.deadlineMs
            : undefined;

    if (!activationId || activationId.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'activationId is required' });
    }
    if (!method || method.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'method is required' });
    }

    // The activation record is the identity. A caller-supplied pluginId,
    // generation or grant list is not read at all.
    const resolution = resolveHostActivation(activationId);
    if (!resolution.ok) {
        throw createError({
            statusCode: resolution.code === 'activation-unknown' ? 403 : 409,
            statusMessage: resolution.message,
            data: { code: resolution.code },
        });
    }
    const record = resolution.record;
    if (record.workspaceId !== workspaceId || record.userId !== userId) {
        revokeHostActivation(activationId, 'session-changed');
        throw createError({
            statusCode: 403,
            statusMessage: 'This activation belongs to another session',
            data: { code: 'activation-session-mismatch' },
        });
    }

    // Live state is re-checked on every call: disable, uninstall, an access
    // policy change or a different selected package ends the activation.
    // Marketplace packages are resolved from the immutable pointer store, not
    // the legacy extension inventory.
    const selected = await resolvePluginPackage(
        record.pluginId,
        EXTENSIONS_BASE_DIR,
        'current'
    );
    if (!selected) {
        revokeHostActivation(activationId, 'plugin-uninstalled');
        throw createError({ statusCode: 403, statusMessage: 'Plugin is not installed' });
    }
    const settingsStore = getWorkspaceSettingsStore(event);
    const enabled = await getEnabledPlugins(settingsStore, workspaceId);
    if (!enabled.includes(record.pluginId)) {
        revokeHostActivation(activationId, 'plugin-disabled');
        throw createError({ statusCode: 403, statusMessage: 'Plugin is not enabled' });
    }
    let manifest;
    try {
        manifest = await readPackageManifest(selected.path);
    } catch {
        revokeHostActivation(activationId, 'selected-package-unreadable');
        throw createError({
            statusCode: 409,
            statusMessage: 'The selected plugin package is unreadable.',
            data: { code: 'activation-stale' },
        });
    }
    const access = await checkPluginAccess(event, {
        pluginId: record.pluginId,
        action: 'use',
        extension: { access: manifest.access ?? null },
    });
    if (!access.decision.allowed) {
        revokeHostActivation(activationId, 'plugin-access-denied');
        throw createError({
            statusCode: 403,
            statusMessage: `Plugin access denied (${access.decision.reasons.join(', ')})`,
        });
    }
    if (selected.digest !== record.packageDigest) {
        revokeHostActivation(activationId, 'selected-package-changed');
        throw createError({
            statusCode: 409,
            statusMessage: 'The selected package changed; start the plugin again',
            data: { code: 'activation-stale' },
        });
    }

    // Consent is live authority. A review may be revoked or replaced after
    // activation, so the sealed snapshot is checked against the current
    // digest/authority record before any method is dispatched.
    let currentReview;
    try {
        const candidate = await packageGrantCandidate({
            packagePath: selected.path,
            packageDigest: selected.digest,
        });
        currentReview = await getPluginGrantReview(
            settingsStore,
            record.workspaceId,
            record.pluginId,
            candidate
        );
    } catch {
        revokeHostActivation(activationId, 'grant-review-unavailable');
        throw createError({
            statusCode: 403,
            statusMessage: 'The plugin authority review is unavailable.',
            data: { code: 'grant-review-unresolved' },
        });
    }
    if (
        currentReview.status !== 'current' ||
        currentReview.revision !== record.grants.revision ||
        currentReview.packageDigest !== record.grants.packageDigest ||
        currentReview.authoritySha256 !== record.grants.authoritySha256 ||
        !sameGrantList(currentReview.requestedGrants, record.grants.requestedGrants) ||
        !sameGrantList(currentReview.approvedGrants, record.grants.approvedGrants)
    ) {
        revokeHostActivation(activationId, 'grant-review-changed');
        throw createError({
            statusCode: 409,
            statusMessage: 'The plugin authority review changed; start the plugin again.',
            data: { code: 'grant-review-stale' },
        });
    }

    const methods = await buildCapabilityMethods({
        config,
        record,
        installedPath: selected.path,
        settingsStore,
    });
    const responses: RpcEnvelope[] = [];
    const broker = new HostRpcBroker({
        pluginId: record.pluginId,
        workspaceId: record.workspaceId,
        generation: record.generation,
        userId: record.userId,
        grants: currentReview,
        methods,
        send: (envelope) => {
            responses.push(envelope);
        },
        budget: {
            admitCall: () => ({ ok: true }),
            releaseCall: () => undefined,
            clampDeadlineMs: (requestedMs) =>
                Math.min(
                    requestedMs ?? DEFAULT_CONTAINMENT_BUDGETS.defaultCallDeadlineMs,
                    DEFAULT_CONTAINMENT_BUDGETS.defaultCallDeadlineMs
                ),
        },
        // The HTTP boundary above resolved the opaque handle and re-checked live
        // state; the broker adds method/grant/replay/deadline/abort enforcement.
        verifyInbound: () => ({ status: 'authorized' }),
    });
    const stopAbort = abortOnDisconnect(event, () => broker.dispose());

    try {
        const outcome = await broker.dispatch({
            v: RPC_ENVELOPE_VERSION,
            kind: 'request',
            id: requestId,
            method,
            params,
            ...(requestedDeadline === undefined ? {} : { deadlineMs: requestedDeadline }),
        });
        const response = responses.find(
            (envelope) => envelope.kind === 'response' || envelope.kind === 'error'
        );
        if (!response) {
            throw createError({
                statusCode: 500,
                statusMessage: outcome.status === 'rejected' ? outcome.message : 'No capability response',
            });
        }
        if (response.kind === 'response') {
            return { ok: true, result: response.result };
        }
        throw capabilityError(response.code, response.message, response.details);
    } finally {
        stopAbort();
        broker.dispose();
    }
});

function sameGrantList(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((grant, index) => grant === right[index]);
}

async function buildCapabilityMethods(input: {
    readonly config: ReturnType<typeof useRuntimeConfig>;
    readonly record: HostActivationRecord;
    readonly installedPath: string;
    readonly settingsStore: ReturnType<typeof getWorkspaceSettingsStore>;
}): Promise<readonly HostRpcMethodSpec[]> {
    const { config, record } = input;
    const methods: HostRpcMethodSpec[] = [];

    methods.push({
        method: AI_MODELS_METHOD,
        grant: 'network.http',
        // A disclosure, not an authority: the allowlist, its prices and the
        // enforced limits. Unconfigured hosts answer explicitly instead of
        // appearing to offer models that every call would refuse.
        handler: () =>
            buildPluginModelCatalog({
                allowed: resolveAllowedModels(config),
                prices: resolveHostModelPrices(config),
            }),
    });

    const apiKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY || '';
    let aiComplete: HostRpcMethodSpec;
    if (!apiKey) {
        aiComplete = {
            method: PLUGIN_AI_COMPLETE_METHOD,
            grant: 'network.http',
            handler: () => {
                throw Object.assign(
                    new Error('No host model provider credential is configured'),
                    { rpcCode: 'unavailable' }
                );
            },
        };
    } else {
        const budget = await readPersistentPluginAiBudget({
            store: input.settingsStore,
            workspaceId: record.workspaceId,
            userId: record.userId,
            pluginId: record.pluginId,
            limitUsd: DEFAULT_CONTAINMENT_BUDGETS.maxAiSpendUsd,
        });
        if (!budget.ok) {
            aiComplete = {
                method: PLUGIN_AI_COMPLETE_METHOD,
                grant: 'network.http',
                handler: () => {
                    throw Object.assign(new Error(budget.message), {
                        rpcCode: 'unavailable',
                    });
                },
            };
        } else {
            const governed = createPluginAiCompleteMethod({
                provider: createOpenRouterPluginProvider({
                    apiKey,
                    baseUrl:
                        config.openrouterBaseUrl ||
                        'https://openrouter.ai/api/v1',
                    prices: resolveHostModelPrices(config),
                }),
                prices: resolveHostModelPrices(config),
                allowedModels: resolveAllowedModels(config),
                initialSpendUsd: budget.budget.spendUsd,
                reserveSpend: async ({ amountUsd }) => {
                    const result = await reservePersistentPluginAiSpend({
                        store: input.settingsStore,
                        workspaceId: record.workspaceId,
                        userId: record.userId,
                        pluginId: record.pluginId,
                        amountUsd,
                        limitUsd: DEFAULT_CONTAINMENT_BUDGETS.maxAiSpendUsd,
                    });
                    return {
                        ok: result.ok,
                        ...(result.ok
                            ? {
                                  reservationId: result.reservationId,
                                  reservationWindowId: result.budget.windowId,
                              }
                            : { code: result.code, message: result.message }),
                    };
                },
                settleSpend: async ({ reservationId, reservationWindowId, actualSpendUsd }) => {
                    const result = await settlePersistentPluginAiSpend({
                        store: input.settingsStore,
                        workspaceId: record.workspaceId,
                        userId: record.userId,
                        pluginId: record.pluginId,
                        reservationId,
                        reservationWindowId,
                        ...(actualSpendUsd === undefined ? {} : { actualSpendUsd }),
                        limitUsd: DEFAULT_CONTAINMENT_BUDGETS.maxAiSpendUsd,
                    });
                    return {
                        ok: result.ok,
                        ...(result.ok ? {} : { code: result.code, message: result.message }),
                    };
                },
            });
            aiComplete = governed;
        }
    }
    methods.push(aiComplete);

    methods.push({
        method: CONNECTIONS_DISPATCH_METHOD,
        grant: 'network.http',
        handler: async (params, context) =>
            dispatchConnection(params, context, {
                pluginId: record.pluginId,
                workspaceId: record.workspaceId,
                userId: record.userId,
                installedPath: input.installedPath,
            }),
    });

    return methods;
}

async function dispatchConnection(
    params: Readonly<Record<string, unknown>>,
    context: HostRpcHandlerContext,
    identity: {
        readonly pluginId: string;
        readonly workspaceId: string;
        readonly userId: string;
        readonly installedPath: string | undefined;
    }
): Promise<unknown> {
    const service = resolveConnectionService();
    if (!service.durable) {
        // A non-durable store would not have the connection this call refers to.
        throw Object.assign(
            new Error('No durable connection store is configured'),
            { rpcCode: 'unavailable' }
        );
    }
    const ref = typeof params.ref === 'string' ? params.ref : '';
    const operationId = typeof params.operationId === 'string' ? params.operationId : '';
    const url = typeof params.url === 'string' ? params.url : '';
    if (!ref || !operationId || !url) {
        throw Object.assign(
            new Error('ref, operationId and url are required'),
            { rpcCode: 'invalid-envelope' }
        );
    }

    // Generic connection dispatch is release-policy driven. A package without
    // a usable policy has no approved operations or destinations, so fail
    // closed before resolving credentials or creating a transport request.
    if (!identity.installedPath) {
        throw Object.assign(
            new Error('The selected package has no usable connection policy'),
            { rpcCode: 'policy-denied' }
        );
    }
    let policy;
    try {
        const descriptors = await loadPackageDescriptors({
            extensionsBaseDir: EXTENSIONS_BASE_DIR,
            packagePath: identity.installedPath,
        });
        if (descriptors.problems.length > 0 || !descriptors.policy) {
            throw new Error('The selected package has no usable connection policy');
        }
        policy = toConnectionDispatchPolicy(descriptors.policy);
    } catch {
        throw Object.assign(
            new Error('The selected package has no usable connection policy'),
            { rpcCode: 'policy-denied' }
        );
    }
    if (!policy) {
        throw Object.assign(
            new Error('The selected package has no usable connection policy'),
            { rpcCode: 'policy-denied' }
        );
    }
    const resolved = await service.service.resolve({
        ref,
        pluginId: identity.pluginId,
        workspaceId: identity.workspaceId,
        ownerUserId: identity.userId,
    });
    if (resolved.status === 'denied') {
        throw Object.assign(new Error(resolved.message), { rpcCode: 'policy-denied' });
    }
    const provider = listConnectionProviders().find(
        (candidate) => candidate.id === resolved.connection.providerId
    );
    if (!provider) {
        throw Object.assign(new Error('Unknown connection provider'), {
            rpcCode: 'invalid-envelope',
        });
    }

    const credential = service.service.revealCredential(resolved.connection);
    if (credential === null) {
        throw Object.assign(new Error('Connection credential is unavailable'), {
            rpcCode: 'unavailable',
        });
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
        policyRequired: true,
        pluginId: identity.pluginId,
        workspaceId: identity.workspaceId,
        generation: context.generation,
        transport: createFetchConnectionTransport(),
        timeoutMs: context.deadlineMs,
    });
    if (outcome.status === 'denied') {
        throw Object.assign(new Error(outcome.message), { rpcCode: 'policy-denied' });
    }
    if (outcome.status === 'failed') {
        return {
            ok: false,
            operationId: outcome.operationId,
            code: outcome.code,
            message: outcome.message,
        };
    }
    return { ok: true, operationId: outcome.operationId, response: outcome.response };
}

function capabilityError(
    code: string,
    message: string,
    details?: Readonly<Record<string, unknown>>
) {
    const statusCode =
        code === 'budget-exceeded'
            ? 429
            : code === 'cancelled'
              ? 499
              : code === 'deadline-exceeded'
                ? 504
                : code === 'unavailable'
                  ? 503
                  : code === 'internal'
                    ? 500
                    : code === 'unknown-method' ||
                        code === 'invalid-envelope' ||
                        code === 'replay' ||
                        code === 'backpressure'
                      ? 400
                      : 403;
    return createError({
        statusCode,
        statusMessage: message,
        data: { rpcCode: code, ...(details === undefined ? {} : { details }) },
    });
}
