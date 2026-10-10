import { z } from 'zod';
import {
    createError,
    defineEventHandler,
    getHeader,
    setResponseHeader,
} from 'h3';
import { useRuntimeConfig } from '#imports';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { requireCloudMutation } from '../../utils/security/cloud-mutation';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { checkAndRecordLlmRequest } from '../../utils/llm/rate-limiter';
import { getRateLimitProvider } from '../../utils/rate-limit/store';
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
    }).strict(),
    z.object({
        workspaceId: z.string().min(1).max(200),
        capture: AutomaticMemoryStateSchema,
    }).strict(),
]);

/** Auxiliary memory inference only: fixed question/model, no writes or arbitrary inference. */
export default defineEventHandler(async (event) => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    if (!isSsrAuthEnabled(event)) throw createError({ statusCode: 404 });
    requireCloudMutation(event);
    const session = await resolveSessionContext(event);
    requireCan(
        session,
        'workspace.write',
        session?.workspace?.id
            ? { kind: 'workspace', id: session.workspace.id }
            : undefined,
    );
    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success)
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid memory classification input.',
        });
    if (
        !session?.authenticated ||
        !session.user?.id ||
        body.data.workspaceId !== session.workspace?.id
    )
        throw createError({ statusCode: 403 });
    const config = useRuntimeConfig(event);
    const clientKey = getHeader(event, 'x-or3-openrouter-key')?.trim();
    const selectedKey =
        config.openrouterRequireUserKey === true ||
        config.openrouterAllowUserOverride !== false
            ? clientKey
            : undefined;
    const key =
        selectedKey ||
        (config.openrouterRequireUserKey !== true
            ? config.openrouterApiKey || process.env.OPENROUTER_API_KEY
            : undefined);
    if (!key)
        throw createError({
            statusCode: 400,
            statusMessage: 'OpenRouter credentials unavailable.',
        });
    // The batch identity is derived here, never trusted from the client. A
    // replay passes the same auth, key and workspace checks as a new request but
    // spends neither the model nor the rate budget.
    const input = body.data;
    const batchKey =
        'capture' in input
            ? session.user.id + ':' + (await automaticMemoryBatchId(input.workspaceId, input.capture))
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
        const rateKey = 'memory:user:' + session.user.id;
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
    const baseUrl = config.openrouterBaseUrl;
    if ('capture' in input) {
        const { capture } = input;
        return await admitMemoryBatch(batchKey!, () =>
            analyzeAutomaticMemory(
                capture,
                key,
                AbortSignal.timeout(CAPTURE_FLIGHT_MS),
                baseUrl,
            ),
        ).catch(unavailable);
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    event.node.req.on('aborted', abort);
    event.node.res?.on('close', abort);
    try {
        return await classifyMemoryReference(
            input.state,
            key,
            controller.signal,
            baseUrl,
        );
    } finally {
        event.node.req.off('aborted', abort);
        event.node.res?.off('close', abort);
    }
});
