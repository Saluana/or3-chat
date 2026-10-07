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
    MemoryClassificationStateSchema,
    classifyMemoryReference,
} from '~~/shared/projects/memory-classification';

const BodySchema = z
    .object({
        workspaceId: z.string().min(1).max(200),
        state: MemoryClassificationStateSchema,
    })
    .strict();

/** Auxiliary classification only: fixed question/model, no writes or arbitrary inference. */
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
    const limits = config.limits;
    if (limits.enabled !== false) {
        const rateKey = 'user:' + session.user.id;
        if (limits.requestsPerMinute > 0) {
            const result = checkAndRecordLlmRequest(rateKey, {
                windowMs: 60000,
                maxRequests: limits.requestsPerMinute,
            });
            if (!result.allowed) throw createError({ statusCode: 429 });
        }
        if (limits.maxMessagesPerDay > 0) {
            const provider = getRateLimitProvider();
            if (!provider) throw createError({ statusCode: 503 });
            const result = await provider.checkAndRecord('daily:' + rateKey, {
                windowMs: 86400000,
                maxRequests: limits.maxMessagesPerDay,
            });
            if (!result.allowed) throw createError({ statusCode: 429 });
        }
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    event.node.req.on('aborted', abort);
    event.node.res?.on('close', abort);
    try {
        return await classifyMemoryReference(
            body.data.state,
            key,
            controller.signal,
        );
    } finally {
        event.node.req.off('aborted', abort);
        event.node.res?.off('close', abort);
    }
});
