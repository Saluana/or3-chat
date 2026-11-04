import { z } from 'zod';
import {
    createError,
    defineEventHandler,
    setResponseHeader,
} from 'h3';
import { useRuntimeConfig } from '#imports';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { requireCloudMutation } from '../../utils/security/cloud-mutation';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { checkAndRecordLlmRequest } from '../../utils/llm/rate-limiter';
import { getRateLimitProvider } from '../../utils/rate-limit/store';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';
import { resolveChatCredential } from '../../utils/ai/chat-router';
import { readFastModel } from '../../utils/ai/fast-model';
import { isOpenAiModel } from '~~/shared/openai/models';
import { FastModelSchema } from '~~/shared/ai/fast-model';
import {
    MemoryBatchCooldownError,
    MEMORY_BATCH_COOLDOWN_MS,
    admitMemoryBatch,
    joinMemoryBatch,
} from '../../utils/llm/memory-batch-admission';
import {
    MemoryClassificationStateSchema,
    classifyMemoryReference,
} from '~~/shared/projects/memory-classification';
import {
    AutomaticMemoryStateSchema,
    analyzeAutomaticMemory,
    automaticMemoryBatchId,
    type AutomaticMemoryOutput,
} from '~~/shared/projects/automatic-memory';

/** Upper bound for a detached capture flight; the gate and extraction deadlines are tighter. */
const CAPTURE_FLIGHT_MS = 25_000;

const BodySchema = z.union([
    z.object({
        workspaceId: z.string().min(1).max(200),
        state: MemoryClassificationStateSchema,
        model: FastModelSchema.optional(),
    }).strict(),
    z.object({
        workspaceId: z.string().min(1).max(200),
        capture: AutomaticMemoryStateSchema,
        model: FastModelSchema.optional(),
    }).strict(),
]);

/**
 * Auxiliary memory inference only: fixed questions on the fast model's router, no writes or arbitrary inference.
 * Cloud uses the workspace fast model. A local install sends its own OpenAI fast model, which runs here so it
 * reaches the configured OpenAI endpoint, paid only with that device's key.
 */
export default defineEventHandler(async (event) => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const cloud = isSsrAuthEnabled(event);
    requireCloudMutation(event);
    const session = await resolveSessionContext(event);
    if (cloud) requireCan(
        session,
        'workspace.write',
        session.workspace?.id
            ? { kind: 'workspace', id: session.workspace.id }
            : undefined,
    );
    // Both inference states share a 240 KiB JSON bound; allow room for the
    // workspace envelope while bounding the transport before JSON parsing.
    const body = BodySchema.safeParse(await readLimitedJsonBody(event, 256 * 1024));
    // Cloud never takes a caller's model; local installs infer OpenRouter in the browser.
    if (!body.success || (cloud ? body.data.model !== undefined : !isOpenAiModel(body.data.model)))
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid memory classification input.',
        });
    if (
        cloud && (
            !session.authenticated ||
            !session.user?.id ||
            body.data.workspaceId !== session.workspace?.id)
    )
        throw createError({ statusCode: 403 });
    const caller = session.user?.id ?? 'local:' + event.node.req.socket?.remoteAddress;
    const config = useRuntimeConfig(event);
    // The fast model chooses the router; its key pays for both stages.
    const fastModel = cloud ? await readFastModel(event, body.data.workspaceId) : body.data.model!;
    const openAi = isOpenAiModel(fastModel);
    const { apiKey: key, source } = await resolveChatCredential(event, fastModel, session);
    if (!key || (!cloud && source !== 'personal'))
        throw createError({
            statusCode: 400,
            statusMessage: `${openAi ? 'OpenAI' : 'OpenRouter'} credentials unavailable.`,
        });
    const inference = { fastModel, apiKey: key, baseUrl: openAi ? config.openaiBaseUrl : config.openrouterBaseUrl };
    // The batch identity is derived here, never trusted from the client. A
    // replay passes the same auth, key and workspace checks as a new request but
    // spends neither the model nor the rate budget.
    const input = body.data;
    const batchKey =
        'capture' in input
            ? caller + ':' + (await automaticMemoryBatchId(input.workspaceId, input.capture, fastModel))
            : undefined;
    const unavailable = (error: unknown): never => {
        const retryAfterMs =
            error instanceof MemoryBatchCooldownError
                ? error.retryAfterMs
                : MEMORY_BATCH_COOLDOWN_MS;
        setResponseHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000));
        throw createError({
            statusCode: 503,
            statusMessage: 'Automatic memory inference unavailable.',
        });
    };
    if (batchKey) {
        const admitted = joinMemoryBatch<AutomaticMemoryOutput>(batchKey);
        if (admitted) return await admitted.catch(unavailable);
    }
    const limits = config.limits;
    // Auxiliary inference has its own buckets: it never spends the user's
    // chat per-minute or daily message quota.
    const limited = (result: { allowed: boolean; retryAfterMs?: number }) => {
        if (result.allowed) return;
        setResponseHeader(event, 'Retry-After', Math.ceil((result.retryAfterMs ?? 1000) / 1000));
        throw createError({ statusCode: 429 });
    };
    if (limits.enabled !== false) {
        const rateKey = 'memory:user:' + caller;
        if (limits.requestsPerMinute > 0)
            limited(checkAndRecordLlmRequest(rateKey, {
                windowMs: 60000,
                maxRequests: limits.requestsPerMinute,
            }));
        const provider = limits.maxMessagesPerDay > 0 ? getRateLimitProvider() : null;
        if (provider)
            limited(await provider.checkAndRecord('daily:' + rateKey, {
                windowMs: 86400000,
                maxRequests: limits.maxMessagesPerDay,
            }));
    }
    if ('capture' in input) {
        const { capture } = input;
        return await admitMemoryBatch(batchKey!, () =>
            analyzeAutomaticMemory(
                capture,
                inference,
                AbortSignal.timeout(CAPTURE_FLIGHT_MS),
            ),
        ).catch(unavailable);
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    event.node.req.on('aborted', abort);
    (event.node as { res?: typeof event.node.res }).res?.on('close', abort);
    try {
        return await classifyMemoryReference(
            input.state,
            inference,
            controller.signal,
        );
    } finally {
        event.node.req.off('aborted', abort);
        (event.node as { res?: typeof event.node.res }).res?.off('close', abort);
    }
});
