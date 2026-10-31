import { z } from 'zod';
import { OPENROUTER_MODEL_VARIANTS } from '../openrouter/model-variants';
import { OPENROUTER_REASONING_EFFORTS } from '../openrouter/reasoning';
import { parseChatGenerationAdmissionEnvelope } from './background-history';

// These records are server-private job state. They are not synced UI metadata.
const id = z.string().min(1).max(256);
const time = z.number().int().nonnegative().safe();
const instruction = z.object({ role: z.enum(['system', 'developer']), content: z.union([
    z.string(), z.array(z.object({ type: z.literal('text'), text: z.string() }).strict()),
]) }).strict();

/** Explicit effective instructions, captured before parent execution mutates its body. */
export const DelegationDefaultsSchema = z.object({ version: z.literal(1), instructions: z.array(instruction).max(8) }).strict()
    .superRefine((defaults, context) => {
        if (new TextEncoder().encode(JSON.stringify(defaults)).length > 64 * 1024)
            context.addIssue({ code: 'custom', message: 'Delegation defaults exceed their durable size limit.' });
    });
const settlement = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('complete'), assistantMessageId: id, result: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('inline'), value: z.string().max(128 * 1024) }).strict(),
        z.object({ kind: z.literal('artifact'), reference: z.string().min(1).max(2048) }).strict(),
    ]) }).strict(),
    ...(['failed', 'stopped', 'unknown', 'unavailable'] as const).map(kind =>
        z.object({ kind: z.literal(kind), code: z.string().min(1).max(200) }).strict()),
]);
const prepared = z.object({
    kind: z.literal('prepared'), index: z.number().int().min(0).max(3),
    admissionId: id, threadId: id, userMessageId: id, assistantMessageId: id,
    admissionFingerprint: z.string().regex(/^sha256:v1:[a-f0-9]{64}$/),
    admission: z.object({ body: z.record(z.string(), z.json()), history: z.json() }).strict(),
    request: z.object({ task: z.string().min(1).max(20_000), model: z.string().min(1).max(200),
        variant: z.enum(OPENROUTER_MODEL_VARIANTS).optional(),
        reasoningEffort: z.enum(OPENROUTER_REASONING_EFFORTS).optional() }).strict(),
    jobId: id.optional(), settlement: settlement.optional(),
}).strict();
const rejected = z.object({
    kind: z.literal('rejected'), index: z.number().int().min(0).max(3),
    settlement: z.object({ kind: z.literal('unavailable'), code: z.string().min(1).max(200) }).strict(),
}).strict();

export const DelegationWaitSchema = z.object({
    version: z.literal(1), revision: z.number().int().nonnegative().safe(),
    callId: id, argumentFingerprint: z.string().regex(/^sha256:v1:[a-f0-9]{64}$/),
    deadlineAt: time, nextCheckAt: time, expiredAt: time.optional(),
    children: z.array(z.discriminatedUnion('kind', [prepared, rejected])).min(1).max(4),
}).strict().superRefine((wait, context) => {
    if (wait.expiredAt !== undefined && wait.expiredAt < wait.deadlineAt)
        context.addIssue({ code: 'custom', message: 'Expiry cannot precede the deadline.' });
    const identities = new Set<string>();
    wait.children.forEach((child, position) => {
        if (child.index !== position) context.addIssue({ code: 'custom', message: 'Child indexes must be contiguous and ordered.' });
        if (child.kind !== 'prepared') return;
        try {
            const history = parseChatGenerationAdmissionEnvelope(child.admission.history);
            if (history.kind !== 'new-turn' || history.admissionId !== child.admissionId ||
                history.threadId !== child.threadId || history.messageId !== child.assistantMessageId ||
                history.userMessage?.id !== child.userMessageId || child.admission.body.model !== child.request.model)
                throw new Error('Child admission identity mismatch');
        } catch {
            context.addIssue({ code: 'custom', message: 'Child admission snapshot is invalid.' });
        }
        for (const value of [child.admissionId, child.threadId, child.userMessageId, child.assistantMessageId, child.jobId]) {
            if (!value) continue;
            if (identities.has(value)) context.addIssue({ code: 'custom', message: 'Child identities must be distinct.' });
            identities.add(value);
        }
        if (child.settlement?.kind === 'complete' && child.settlement.assistantMessageId !== child.assistantMessageId)
            context.addIssue({ code: 'custom', message: 'Completed result must refer to the admitted assistant message.' });
        if (child.settlement && child.settlement.kind !== 'unavailable' && !child.jobId)
            context.addIssue({ code: 'custom', message: 'A terminal or unknown child must have an admitted job.' });
    });
    if (new TextEncoder().encode(JSON.stringify(wait)).length > 256 * 1024)
        context.addIssue({ code: 'custom', message: 'Delegation checkpoint exceeds its durable size limit.' });
});

export const DelegationDispatchSchema = z.object({
    version: z.literal(1), sequence: z.number().int().positive().safe(), state: z.literal('started'),
}).strict();

/** Bounded, credential-free metadata intended for canonical parent history. */
export const DelegationActivitySchema = z.object({
    version: z.literal(1), callId: id,
    children: z.array(z.object({
        index: z.number().int().min(0).max(3), threadId: id.optional(),
        modelName: z.string().min(1).max(200).optional(),
        outcome: z.enum(['complete', 'failed', 'stopped', 'unknown', 'unavailable']),
        executionUncertain: z.literal(true).optional(),
    }).strict()).min(1).max(4),
}).strict().superRefine((activity, context) => {
    activity.children.forEach((child, index) => {
        if (child.index !== index) context.addIssue({ code: 'custom', message: 'Activity indexes must be contiguous and ordered.' });
        if (child.outcome === 'complete' && !child.threadId)
            context.addIssue({ code: 'custom', message: 'A completed child requires a chat link.' });
        if (child.executionUncertain && child.outcome !== 'unavailable')
            context.addIssue({ code: 'custom', message: 'Execution uncertainty is only needed when history is unavailable.' });
    });
});

/** Ephemeral viewer projection; never written as a canonical terminal outcome. */
export const DelegationLiveActivitySchema = z.object({
    version: z.union([z.literal(2), z.literal(3)]), callId: id,
    children: z.array(z.object({
        index: z.number().int().min(0).max(3), threadId: id.optional(),
        modelName: z.string().min(1).max(200).optional(),
        outcome: z.enum(['waiting', 'working', 'saving', 'complete', 'failed', 'stopped', 'unknown', 'unavailable']),
    }).strict()).min(1).max(4),
}).strict().superRefine((activity, context) => {
    activity.children.forEach((child, index) => {
        if (child.index !== index) context.addIssue({ code: 'custom', message: 'Activity indexes must be contiguous and ordered.' });
        if (activity.version === 2 && child.outcome === 'saving')
            context.addIssue({ code: 'custom', message: 'Saving requires live activity version 3.' });
        if (child.outcome === 'complete' && !child.threadId)
            context.addIssue({ code: 'custom', message: 'A completed child requires a chat link.' });
    });
});

export const DelegationDisplayActivitySchema = z.union([DelegationActivitySchema, DelegationLiveActivitySchema]);

export type DelegationWait = z.infer<typeof DelegationWaitSchema>;
export type DelegationDefaults = z.infer<typeof DelegationDefaultsSchema>;
export type DelegationDispatch = z.infer<typeof DelegationDispatchSchema>;
export type DelegationActivity = z.infer<typeof DelegationActivitySchema>;
export type DelegationDisplayActivity = z.infer<typeof DelegationDisplayActivitySchema>;
