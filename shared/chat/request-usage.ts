import { normalizeProviderRequestUsage, type ProviderRequestUsage } from '../openrouter/parseOpenRouterSSE';
import { sha256Hex as digest } from '../runtime-crypto';
import { readRequestUsage, type RequestUsage, type UsageTotals } from './compaction';
import { estimateChatRequest, type CountableChatMessage, type ContextEstimate } from './context-budget';

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
function fingerprintConfiguration(configuration?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!configuration) return undefined;
    // Reply allowance cannot change the already measured input prefix. All
    // input-affecting routing, tools, cache and reasoning configuration remains.
    const { max_tokens: _reply, ...rest } = configuration;
    return rest;
}
/** Match persisted SHA-256 attachment refs to provider bytes without loading files in the preview. */
async function fingerprintMessages(messages: readonly CountableChatMessage[]): Promise<string> {
    const reference = async (value: unknown) => {
        if (typeof value !== 'string' || !/^data:[^,]*;base64,/.test(value)) return value;
        const binary = atob(value.slice(value.indexOf(',') + 1));
        return `sha256:${await digest(Uint8Array.from(binary, (char) => char.charCodeAt(0)))}`;
    };
    const rows: CountableChatMessage[] = [];
    for (const message of messages) {
        const parts: Record<string, unknown>[] = [];
        for (const part of typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? []) {
            const { width: _width, height: _height, ...content } = part as Record<string, unknown>;
            if (part.type === 'image_url') {
                const image = content.image_url as { url?: string } | undefined;
                content.image_url = { ...image, url: await reference(image?.url) };
            } else if (part.type === 'file') {
                const file = content.file as { file_data?: string } | undefined;
                content.file = { ...file, file_data: await reference(file?.file_data) };
            }
            parts.push(content);
        }
        rows.push({ role: message.role, name: message.name, tool_call_id: message.tool_call_id,
            tool_calls: message.tool_calls, content: parts as CountableChatMessage['content'] });
    }
    return digest(stable(rows));
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
        fingerprintMessages(snapshot.messages),
        digest(stable({ model: snapshot.model, tools: snapshot.tools, modalities: snapshot.modalities,
            configuration: fingerprintConfiguration(snapshot.configuration) })),
        estimateChatRequest({ model: snapshot.model, messages: snapshot.messages, tools: snapshot.tools,
            configuration: estimateConfiguration(snapshot.configuration), countText: input.countText }),
    ]);
    return Object.freeze({ model: snapshot.model, prefix_message_count: snapshot.messages.length,
        prefix_hash: prefixHash, configuration_hash: configurationHash, input_estimate_tokens: estimate.input_tokens });
}
/** Tools are already counted separately; the fingerprint still covers the complete configuration. */
function estimateConfiguration(configuration?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!configuration) return undefined;
    const { tools: _tools, ...rest } = configuration;
    return rest;
}

/** A measured prefix contributes only when its content, attachment identities and routing still match. */
export async function estimateMeasuredChatRequest(input: {
    model: string; messages: readonly CountableChatMessage[]; tools?: readonly unknown[];
    modalities?: readonly string[]; configuration?: Record<string, unknown>;
    usage?: unknown; countText: (text: string) => Promise<number>;
}): Promise<ContextEstimate> {
    const snapshot = structuredClone({ model: input.model, messages: input.messages, tools: input.tools,
        modalities: input.modalities, configuration: input.configuration, usage: input.usage });
    const full = await estimateChatRequest({ model: snapshot.model, messages: snapshot.messages, tools: snapshot.tools,
        configuration: estimateConfiguration(snapshot.configuration), countText: input.countText });
    const usage = readRequestUsage(snapshot.usage);
    if (!usage || usage.model !== snapshot.model || usage.prefix_message_count > snapshot.messages.length
        || usage.prompt_tokens <= 0) return full;
    const prefix = await captureUsagePrefix({ ...snapshot,
        messages: snapshot.messages.slice(0, usage.prefix_message_count), countText: input.countText });
    if (prefix.prefix_hash !== usage.prefix_hash || prefix.configuration_hash !== usage.configuration_hash) return full;
    const suffix = await estimateChatRequest({ model: snapshot.model, messages: snapshot.messages.slice(usage.prefix_message_count), countText: input.countText });
    const empty = await estimateChatRequest({ messages: [], countText: input.countText });
    return { input_tokens: usage.prompt_tokens + suffix.input_tokens - empty.input_tokens,
        basis: 'measured-prefix', media_cost: suffix.media_cost };
}
/** Missing/invalid measurement stays absent; a later request replaces occupancy rather than summing it. */
export function attachRequestUsage(prefix: UsagePrefix | undefined, measurement: unknown,
    identity: { requestId: string; iteration: number; measuredAt: number }): RequestUsage | undefined {
    const usage = normalizeProviderRequestUsage(measurement);
    if (!prefix || !usage) return undefined;
    return readRequestUsage({ ...prefix, ...usage, model: usage.model ?? prefix.model,
        request_id: usage.response_id ?? identity.requestId, iteration: identity.iteration, measured_at: identity.measuredAt });
}

/** Adds one measured provider request to a reply's running totals. */
export function addUsageTotals(prior: UsageTotals | undefined, request: ProviderRequestUsage): UsageTotals {
    const sum = (a: number | undefined, b: number | undefined) => a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
    const cost = sum(prior?.cost, request.cost);
    const cached = sum(prior?.cached_tokens, request.cached_tokens);
    const reasoning = sum(prior?.reasoning_tokens, request.reasoning_tokens);
    return { requests: (prior?.requests ?? 0) + 1,
        prompt_tokens: (prior?.prompt_tokens ?? 0) + request.prompt_tokens,
        completion_tokens: (prior?.completion_tokens ?? 0) + request.completion_tokens,
        ...(cost !== undefined ? { cost } : {}), ...(cached !== undefined ? { cached_tokens: cached } : {}),
        ...(reasoning !== undefined ? { reasoning_tokens: reasoning } : {}) };
}

/** Internal provenance must describe this exact measurement, never an older request's counters. */
export function readMeasuredRequestUsage(measurement: unknown, record: unknown): RequestUsage | undefined {
    const usage = normalizeProviderRequestUsage(measurement); const validated = readRequestUsage(record);
    return usage && validated && validated.prompt_tokens === usage.prompt_tokens && validated.completion_tokens === usage.completion_tokens
        && (!usage.model || validated.model === usage.model) && (!usage.response_id || validated.request_id === usage.response_id) ? validated : undefined;
}
