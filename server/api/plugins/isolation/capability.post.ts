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
 * - Every method is dispatched through the host RPC broker, so grant, deadline
 *   and abort enforcement are the same code path the in-page bridge uses. Replay
 *   and concurrency are enforced at activation scope across HTTP requests (not
 *   per broker), so a duplicate request ID or a flooded activation is refused no
 *   matter how many connections it uses. A disconnected client aborts the
 *   in-flight handler, and revoking the activation aborts every remaining call.
 * - Launch topology is a single Node process per host: handles and admission
 *   state are process-local, a restart forgets them together, and stale calls
 *   fail closed and must remint.
 *
 * Every refusal is a structured 4xx/5xx with the reason, never a silent success.
 */

import { createError, defineEventHandler, type H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
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
import { authorizeHostActivation } from '../../../utils/plugins/isolation/activation-authorization';
import { tryAdmitActivationCall } from '../../../utils/plugins/isolation/activation-admission';
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

interface ClientDisconnectTracker {
    /** True once the connection closed before the response completed. */
    isDisconnected(): boolean;
    /** Invoke the listener on a future disconnect; returns an unsubscribe. */
    onDisconnect(listener: () => void): () => void;
    /** Stop tracking; the admitted region calls this once it settles. */
    dispose(): void;
}

/**
 * Track client disconnects from route entry, including an already-closed
 * response. A listener installed only after authorization and preparation
 * would never notice a connection that closed during those awaits.
 *
 * The admitted region disposes its tracker when it settles. Earlier exits
 * leave the one listener until the request's own close, which bounds it.
 */
function trackClientDisconnect(event: H3Event): ClientDisconnectTracker {
    const res = (
        event.node as {
            readonly res?: {
                on: (name: string, listener: () => void) => void;
                off: (name: string, listener: () => void) => void;
                writableEnded?: boolean;
                destroyed?: boolean;
            };
        }
    ).res;
    if (!res) {
        return {
            isDisconnected: () => false,
            onDisconnect: () => () => undefined,
            dispose: () => undefined,
        };
    }
    let disconnected = res.destroyed === true;
    const listeners = new Set<() => void>();
    const onClose = () => {
        if (res.writableEnded) return;
        disconnected = true;
        for (const listener of [...listeners]) listener();
    };
    res.on('close', onClose);
    return {
        isDisconnected: () => disconnected,
        onDisconnect: (listener: () => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        dispose: () => {
            listeners.clear();
            res.off('close', onClose);
        },
    };
}

/** Clamp a plugin-requested call deadline to the host ceiling. */
function clampCallDeadlineMs(requestedMs: number | undefined): number {
    const requested =
        typeof requestedMs === 'number' && Number.isFinite(requestedMs) && requestedMs > 0
            ? requestedMs
            : undefined;
    return Math.min(
        requested ?? DEFAULT_CONTAINMENT_BUDGETS.defaultCallDeadlineMs,
        DEFAULT_CONTAINMENT_BUDGETS.defaultCallDeadlineMs
    );
}

export default defineEventHandler(async (event) => {
    requirePluginMutation(event);
    const config = useRuntimeConfig();
    if (!config.auth.enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    // Installed before the first await so a disconnect during session,
    // authorization or preparation is still observed below.
    const disconnect = trackClientDisconnect(event);

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
        typeof body?.requestId === 'string' &&
        body.requestId.length >= 1 &&
        body.requestId.length <= 128
            ? body.requestId
            : `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
    // the legacy extension inventory. A blocked/recovered-current pointer ends
    // the activation instead of falling through to legacy code.
    const selected = await resolvePluginPackage(
        record.pluginId,
        EXTENSIONS_BASE_DIR,
        'current'
    );
    if (!selected) {
        revokeHostActivation(activationId, 'plugin-uninstalled');
        throw createError({
            statusCode: 403,
            statusMessage: 'Plugin is not installed',
            data: { code: 'plugin-uninstalled' },
        });
    }
    if (selected.status === 'blocked' || !selected.path) {
        revokeHostActivation(activationId, 'selected-package-blocked');
        throw createError({
            statusCode: 409,
            statusMessage: 'The selected plugin package is blocked or inactive; start the plugin again after recovery.',
            data: { code: 'activation-stale', issues: selected.issues },
        });
    }

    // Live enablement, access policy, selected digest and grant review are
    // re-checked through the shared activation authorization path, the same one
    // the runtime settings-save endpoint uses. A stale handle is revoked before
    // the refusal is returned.
    const settingsStore = getWorkspaceSettingsStore(event);
    const authorized = await authorizeHostActivation({
        event,
        activationId,
        pluginId: record.pluginId,
        workspaceId,
        userId,
        packagePath: selected.path,
        packageDigest: selected.digest,
        settingsStore,
    });
    if (!authorized.ok) {
        throw createError({
            statusCode: authorized.statusCode,
            statusMessage: authorized.message,
            data: { code: authorized.code },
        });
    }
    const currentReview = authorized.review;

    // Synchronous recheck with no intervening await: authorization performed
    // several reads after its own registry check, and a revocation that landed
    // during them must refuse here rather than let admission recreate state
    // for a dead handle.
    const fresh = resolveHostActivation(activationId);
    if (!fresh.ok) {
        throw createError({
            statusCode: fresh.code === 'activation-unknown' ? 403 : 409,
            statusMessage: fresh.message,
            data: { code: fresh.code },
        });
    }

    // Activation-scoped admission spans HTTP requests: a duplicate request ID
    // is rejected whether it arrives on the same connection or a new one, and
    // concurrent calls share one limit instead of each seeing an empty broker.
    // Duplicates are rejected, never silently recomputed or retried. A pure
    // read may be issued again under a new request ID; a provider call or
    // external write with an uncertain outcome must not be auto-retried — the
    // caller surfaces the failure and waits for an explicit user-driven retry.
    const admission = tryAdmitActivationCall(activationId, {
        requestId,
        method,
        params,
    });
    if (!admission.ok) {
        throw capabilityError(admission.code, admission.message, admission.details);
    }

    // The admitted region below runs entirely inside try/finally so the slot
    // is released exactly once. The deadline starts at admission and covers
    // preparation as well as dispatch: a stalled budget read must not retain
    // the slot past the configured call deadline. The broker keeps its own
    // deadline as a backstop; it starts later, so this timer fires first.
    const callDeadlineMs = clampCallDeadlineMs(requestedDeadline);
    let releaseOutcome = 'completed';
    // Holder object: the timer callback flips this across awaits, which a
    // narrowed local boolean would misrepresent to the type checker.
    const admissionClock = { timedOut: false };
    const admissionTimer = setTimeout(() => {
        admissionClock.timedOut = true;
        try {
            admission.controller.abort('deadline-exceeded');
        } catch {
            // Aborting a settled call is a no-op.
        }
    }, callDeadlineMs);
    // Registered before any preparation await so a disconnect during the
    // budget read aborts the admission immediately; the post-preparation
    // checks below then refuse to dispatch.
    const stopDisconnectForward = disconnect.onDisconnect(() => {
        try {
            admission.controller.abort('client-disconnected');
        } catch {
            // Aborting a settled call is a no-op.
        }
    });
    const throwIfSettledEarly = (): void => {
        if (admissionClock.timedOut) {
            releaseOutcome = 'deadline-exceeded';
            throw capabilityError('deadline-exceeded', 'Capability call exceeded its deadline');
        }
        if (admission.controller.signal.aborted || disconnect.isDisconnected()) {
            releaseOutcome = 'cancelled';
            throw capabilityError('cancelled', 'Capability call was cancelled');
        }
    };

    try {
        // An already-disconnected client must not pay for preparation.
        throwIfSettledEarly();
        // Preparation is raced against the admission signal: a stalled budget
        // read must not retain the admission slot past the deadline or a
        // disconnect. The abandoned preparation can no longer dispatch because
        // this request fails closed here, and its rejection is observed so it
        // cannot surface as an unhandled rejection.
        const preparation = buildCapabilityMethods({
            config,
            record,
            installedPath: selected.path,
            settingsStore,
        });
        const methods = await new Promise<readonly HostRpcMethodSpec[]>(
            (resolve, reject) => {
                let settled = false;
                const onAbort = () => {
                    if (settled) return;
                    settled = true;
                    preparation.catch(() => undefined);
                    // A revocation that aborts the admission is a precise
                    // refusal, not a generic cancellation: the caller must see
                    // the lifecycle code so it can offer a restart.
                    const lifecycle = resolveHostActivation(activationId);
                    if (!lifecycle.ok) {
                        reject(
                            createError({
                                statusCode:
                                    lifecycle.code === 'activation-unknown' ? 403 : 409,
                                statusMessage: lifecycle.message,
                                data: { code: lifecycle.code },
                            })
                        );
                        return;
                    }
                    reject(
                        admissionClock.timedOut
                            ? capabilityError(
                                  'deadline-exceeded',
                                  'Capability call exceeded its deadline'
                              )
                            : capabilityError('cancelled', 'Capability call was cancelled')
                    );
                };
                if (admission.controller.signal.aborted) {
                    onAbort();
                    return;
                }
                admission.controller.signal.addEventListener('abort', onAbort, {
                    once: true,
                });
                preparation.then(
                    (value) => {
                        if (settled) return;
                        settled = true;
                        admission.controller.signal.removeEventListener(
                            'abort',
                            onAbort
                        );
                        resolve(value);
                    },
                    (error) => {
                        if (settled) return;
                        settled = true;
                        admission.controller.signal.removeEventListener(
                            'abort',
                            onAbort
                        );
                        reject(error);
                    }
                );
            }
        );

        // Post-preparation rechecks, all synchronous: a revocation, abort,
        // disconnect or deadline during preparation must prevent dispatch.
        const current = resolveHostActivation(activationId);
        if (!current.ok) {
            releaseOutcome = 'cancelled';
            throw createError({
                statusCode: current.code === 'activation-unknown' ? 403 : 409,
                statusMessage: current.message,
                data: { code: current.code },
            });
        }
        throwIfSettledEarly();

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
            // One dispatch per HTTP request; cross-request concurrency lives in
            // the activation admission above.
            maxInFlight: 1,
            budget: {
                admitCall: () => ({ ok: true }),
                releaseCall: () => undefined,
                clampDeadlineMs: (requestedMs) => clampCallDeadlineMs(requestedMs),
            },
            // The HTTP boundary above resolved the opaque handle and re-checked
            // live state; the broker adds method/grant/deadline/abort
            // enforcement.
            verifyInbound: () => ({ status: 'authorized' }),
        });
        // Mid-call revocation aborts the broker through the admission
        // controller. The listener cannot replay an abort that fired before it
        // was attached, so an already-aborted signal disposes explicitly.
        const onAdmissionAbort = () => broker.dispose();
        admission.controller.signal.addEventListener('abort', onAdmissionAbort);
        try {
            if (admission.controller.signal.aborted || disconnect.isDisconnected()) {
                broker.dispose();
                throwIfSettledEarly();
            }
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
                releaseOutcome = 'failed';
                throw createError({
                    statusCode: 500,
                    statusMessage: outcome.status === 'rejected' ? outcome.message : 'No capability response',
                });
            }
            if (response.kind === 'response') {
                releaseOutcome = 'completed';
                return { ok: true, result: response.result };
            }
            // The admission timer aborts through the same controller as a
            // disconnect, so a timeout that fires mid-dispatch would otherwise
            // surface as `cancelled`: prefer the recorded cause.
            if (admissionClock.timedOut) {
                releaseOutcome = 'deadline-exceeded';
                throw capabilityError('deadline-exceeded', 'Capability call exceeded its deadline');
            }
            releaseOutcome =
                response.code === 'cancelled' || response.code === 'deadline-exceeded'
                    ? response.code
                    : 'failed';
            throw capabilityError(response.code, response.message, response.details);
        } finally {
            admission.controller.signal.removeEventListener('abort', onAdmissionAbort);
            broker.dispose();
        }
    } catch (error) {
        // Paths that set their own outcome keep it; anything else (a failed
        // preparation build) is labeled by its cause instead of `completed`.
        if (releaseOutcome === 'completed') {
            releaseOutcome = admissionClock.timedOut
                ? 'deadline-exceeded'
                : admission.controller.signal.aborted || disconnect.isDisconnected()
                  ? 'cancelled'
                  : 'failed';
        }
        throw error;
    } finally {
        clearTimeout(admissionTimer);
        stopDisconnectForward();
        disconnect.dispose();
        admission.release(releaseOutcome);
    }
});

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

    // The awaits above (descriptors, connection lookup) can outlive a
    // revocation or disconnect. Never start the external request afterwards:
    // fail closed here, and let the transport abort a request already running.
    if (context.signal.aborted) {
        throw Object.assign(new Error('Connection dispatch was cancelled'), {
            rpcCode: 'cancelled',
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
        signal: context.signal,
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
