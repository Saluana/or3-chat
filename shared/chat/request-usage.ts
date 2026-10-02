import { normalizeProviderRequestUsage } from '../openrouter/parseOpenRouterSSE';
import { readRequestUsage, type RequestUsage } from './compaction';
import { estimateChatRequest, type CountableChatMessage } from './context-budget';

export interface UsagePrefix {
    readonly model: string;
    readonly prefix_message_count: number;
    readonly prefix_hash: string;
    readonly configuration_hash: string;
    readonly input_estimate_tokens: number;
}
function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
async function digest(value: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** Snapshot synchronously, before counting/hashing awaits can observe later tool-loop mutations. */
export async function captureUsagePrefix(input: {
    model: string; messages: readonly CountableChatMessage[]; tools?: readonly unknown[];
    modalities?: readonly string[]; configuration?: Record<string, unknown>;
    countText: (text: string) => Promise<number>;
}): Promise<UsagePrefix> {
    const snapshot = JSON.parse(JSON.stringify({ model: input.model, messages: input.messages, tools: input.tools,
        modalities: input.modalities, configuration: input.configuration })) as Omit<typeof input, 'countText'>;
    const [prefixHash, configurationHash, estimate] = await Promise.all([
        digest(stable(snapshot.messages)),
        digest(stable({ model: snapshot.model, tools: snapshot.tools, modalities: snapshot.modalities, configuration: snapshot.configuration })),
        estimateChatRequest({ messages: snapshot.messages, tools: snapshot.tools, countText: input.countText }),
    ]);
    return Object.freeze({ model: snapshot.model, prefix_message_count: snapshot.messages.length,
        prefix_hash: prefixHash, configuration_hash: configurationHash, input_estimate_tokens: estimate.input_tokens });
}
/** Missing/invalid measurement stays absent; a later request replaces occupancy rather than summing it. */
export function attachRequestUsage(prefix: UsagePrefix | undefined, measurement: unknown,
    identity: { requestId: string; iteration: number; measuredAt: number }): RequestUsage | undefined {
    const usage = normalizeProviderRequestUsage(measurement);
    if (!prefix || !usage) return undefined;
    return readRequestUsage({ ...prefix, ...usage, model: usage.model ?? prefix.model,
        request_id: usage.response_id ?? identity.requestId, iteration: identity.iteration, measured_at: identity.measuredAt });
}

/** Internal provenance must describe this exact measurement, never an older request's counters. */
export function readMeasuredRequestUsage(measurement: unknown, record: unknown): RequestUsage | undefined {
    const usage = normalizeProviderRequestUsage(measurement); const validated = readRequestUsage(record);
    return usage && validated && validated.prompt_tokens === usage.prompt_tokens && validated.completion_tokens === usage.completion_tokens
        && (!usage.model || validated.model === usage.model) && (!usage.response_id || validated.request_id === usage.response_id) ? validated : undefined;
}
