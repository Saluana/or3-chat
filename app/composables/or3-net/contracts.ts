import { z } from 'zod';

import type {
    Or3NetErrorEnvelope,
    Or3NetExchangeResponse,
    Or3NetJobStreamEvent,
} from './types';

export const or3ChatSessionProofSchema = z.object({
    format: z.literal('or3-chat-assertion-v1'),
    assertion: z.string().trim().min(1),
});

export const or3NetExchangeRequestSchema = z.object({
    provider: z.literal('or3-chat'),
    session_proof: or3ChatSessionProofSchema,
    workspace_id: z.string().trim().min(1).optional(),
});

export const or3NetExchangeResponseSchema = z.object({
    token: z.string().trim().min(1),
    workspace_id: z.string().trim().min(1),
    expires_at: z.string().trim().min(1),
    scopes: z.array(z.string().trim().min(1)),
});

export const or3NetErrorEnvelopeSchema = z.object({
    error: z.string().trim().min(1).optional(),
    code: z.string().trim().min(1).optional(),
    status: z.number().int().nonnegative().optional(),
    request_id: z.string().trim().min(1).optional(),
    retry_after_ms: z.number().finite().nonnegative().optional(),
});

const unknownRecordSchema = z.record(z.string(), z.unknown());

export const or3NetJobStreamEventSchema = z.discriminatedUnion('event', [
    z.object({
        event: z.literal('job.accepted'),
        data: z.object({ job_id: z.string().trim().min(1) }),
    }),
    z.object({
        event: z.literal('job.started'),
        data: z.object({
            job_id: z.string().trim().min(1),
            started_at: z.string().trim().min(1).optional(),
        }),
    }),
    z.object({
        event: z.literal('text.delta'),
        data: z.object({ text: z.string() }),
    }),
    z.object({
        event: z.literal('tool.call'),
        data: z.object({
            name: z.string().trim().min(1),
            tool_call_id: z.string().trim().min(1).optional(),
            arguments: z.union([z.string(), unknownRecordSchema]).optional(),
        }),
    }),
    z.object({
        event: z.literal('tool.result'),
        data: z.object({
            name: z.string().trim().min(1),
            tool_call_id: z.string().trim().min(1).optional(),
            result: z.union([z.string(), unknownRecordSchema]).optional(),
            content: z.string().optional(),
        }),
    }),
    z.object({
        event: z.literal('job.completed'),
        data: z.object({
            job_id: z.string().trim().min(1).optional(),
        }).catchall(z.unknown()),
    }),
    z.object({
        event: z.literal('job.failed'),
        data: z.object({}).catchall(z.unknown()),
    }),
    z.object({
        event: z.literal('job.aborted'),
        data: z.object({ job_id: z.string().trim().min(1) }),
    }),
    z.object({
        event: z.literal('error'),
        data: or3NetErrorEnvelopeSchema,
    }),
]);

export function parseOr3NetExchangeResponse(input: unknown): Or3NetExchangeResponse | null {
    const parsed = or3NetExchangeResponseSchema.safeParse(input);
    return parsed.success ? (parsed.data as Or3NetExchangeResponse) : null;
}

export function parseOr3NetErrorEnvelope(input: unknown): Or3NetErrorEnvelope | null {
    const parsed = or3NetErrorEnvelopeSchema.safeParse(input);
    return parsed.success ? (parsed.data as Or3NetErrorEnvelope) : null;
}

export function normalizeOr3NetJobStreamEvent(
    eventName: string,
    payload: unknown
): Or3NetJobStreamEvent | null {
    const parsed = or3NetJobStreamEventSchema.safeParse({
        event: eventName,
        data: payload ?? {},
    });
    return parsed.success ? (parsed.data as Or3NetJobStreamEvent) : null;
}
