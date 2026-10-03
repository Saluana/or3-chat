import { describe, it, expect } from 'vitest';
import { captureUsagePrefix, attachRequestUsage, readMeasuredRequestUsage, estimateMeasuredChatRequest } from '../request-usage';
import { estimateChatRequest, type CountableChatMessage } from '../context-budget';
const countText = async (text: string) => Math.ceil(text.length / 4);
const request = () => ({ model: 'large-model', messages: [{ role: 'user', content: 'Original task' }],
    tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }], modalities: ['text'], countText });
describe('measured request prefix provenance', () => {

    it('uses a matched measured prefix plus the current suffix, never below complete-request estimation', async () => {
        const input = { ...request(), configuration: { reasoning: { effort: 'medium' }, max_tokens: 4096 } };
        const prefix = await captureUsagePrefix(input);
        const messages = [...input.messages, { role: 'assistant', content: 'Prior answer' }, { role: 'user', content: 'New draft' }];
        const suffix = await estimateChatRequest({ messages: messages.slice(1), countText });
        const empty = await estimateChatRequest({ messages: [], countText });
        for (const prompt of [prefix.input_estimate_tokens + 1000, 1]) {
            const usage = attachRequestUsage(prefix, { prompt_tokens: prompt, completion_tokens: 5 }, { requestId: 'measured', iteration: 1, measuredAt: 1 });
            const next = { ...input, messages, configuration: { ...input.configuration, max_tokens: 8192 }, usage };
            const full = await estimateChatRequest(next);
            expect(await estimateMeasuredChatRequest(next)).toEqual({ ...full, basis: 'measured-prefix',
                input_tokens: Math.max(full.input_tokens, prompt + suffix.input_tokens - empty.input_tokens) });
        }
    });

    it.each(['text', 'model', 'tools', 'reasoning', 'shorter', 'missing', 'zero'] as const)('falls back to complete estimation for %s provenance', async (change) => {
        const initial = { ...request(), configuration: { reasoning: { effort: 'medium' } } };
        const prefix = await captureUsagePrefix(initial);
        const usage = attachRequestUsage(prefix, { prompt_tokens: change === 'zero' ? 0 : 500_000, completion_tokens: 5 }, { requestId: 'measured', iteration: 1, measuredAt: 1 });
        const next = structuredClone({ ...initial, countText: undefined, usage });
        if (change === 'text') next.messages[0]!.content = 'Edited prefix';
        if (change === 'model') next.model = 'large-model:floor';
        if (change === 'tools') next.tools[0]!.function.name = 'different';
        if (change === 'reasoning') next.configuration.reasoning.effort = 'high';
        if (change === 'shorter') next.messages = [];
        if (change === 'missing') next.usage = undefined;
        const full = await estimateChatRequest({ ...next, countText });
        expect(await estimateMeasuredChatRequest({ ...next, countText })).toEqual(full);
    });

    it('retains media uncertainty in matched hydrated history and invalidates changed image bytes', async () => {
        const messages: CountableChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'Image caption' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }];
        const initial = { ...request(), messages };
        const usage = attachRequestUsage(await captureUsagePrefix(initial), { prompt_tokens: 1000, completion_tokens: 5 }, { requestId: 'media', iteration: 1, measuredAt: 1 });
        expect(await estimateMeasuredChatRequest({ ...initial, usage })).toMatchObject({ basis: 'measured-prefix', media_cost: 'unknown' });
        const edited = { ...initial, messages: [{ role: 'user', content: [{ type: 'text', text: 'Image caption' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,BBBB' } }] }], usage };
        expect(await estimateMeasuredChatRequest(edited)).toEqual(await estimateChatRequest(edited));
    });
    it('snapshots the actual prefix before asynchronous counting and binds measurement to that request', async () => {
        const input = request(); let release!: () => void;
        const paused = new Promise<void>((resolve) => { release = resolve; });
        const capture = captureUsagePrefix({ ...input, countText: async (text: string) => { await paused; return countText(text); } });
        input.messages[0]!.content = 'Later mutation'; release();
        const prefix = await capture;
        expect(prefix.prefix_hash).toBe((await captureUsagePrefix(request())).prefix_hash);
        expect(prefix.prefix_message_count).toBe(1); expect(prefix.input_estimate_tokens).toBeGreaterThan(0);
        const usage = attachRequestUsage(prefix, { prompt_tokens: 180000, completion_tokens: 42, response_id: 'provider-request', model: 'resolved-model' },
            { requestId: 'host-request', iteration: 2, measuredAt: 123 });
        expect(usage).toMatchObject({ model: 'resolved-model', request_id: 'provider-request', iteration: 2, measured_at: 123,
            prompt_tokens: 180000, completion_tokens: 42, prefix_hash: prefix.prefix_hash, configuration_hash: prefix.configuration_hash });
    });
    it('invalidates changed text/tool results or configuration without hashing credentials or unrelated UI fields', async () => {
        const initial = await captureUsagePrefix(request());
        const text = request(); text.messages[0]!.content = 'Changed task';
        expect((await captureUsagePrefix(text)).prefix_hash).not.toBe(initial.prefix_hash);
        const config = request(); config.tools[0]!.function.name = 'different';
        expect((await captureUsagePrefix(config)).configuration_hash).not.toBe(initial.configuration_hash);
        expect((await captureUsagePrefix({ ...request(), model: 'other-model' })).configuration_hash).not.toBe(initial.configuration_hash);
        const reordered = { ...request(), tools: [{ function: { parameters: { type: 'object' }, name: 'lookup' }, type: 'function' }] };
        expect((await captureUsagePrefix(reordered)).configuration_hash).toBe(initial.configuration_hash);
    });
    it('does not turn missing/malformed measurements into zero and preserves explicit provider zero', async () => {
        const prefix = await captureUsagePrefix(request());
        expect(attachRequestUsage(prefix, undefined, { requestId: 'host', iteration: 1, measuredAt: 1 })).toBeUndefined();
        expect(attachRequestUsage(prefix, { prompt_tokens: -1, completion_tokens: 4 }, { requestId: 'host', iteration: 1, measuredAt: 1 })).toBeUndefined();
        expect(attachRequestUsage(prefix, { prompt_tokens: 0, completion_tokens: 0 }, { requestId: 'host', iteration: 1, measuredAt: 1 }))
            .toMatchObject({ request_id: 'host', model: 'large-model', prompt_tokens: 0, completion_tokens: 0 });
    });
    it('rejects old or malformed provenance for a new provider measurement', async () => {
        const prefix = await captureUsagePrefix(request());
        const initial = { prompt_tokens: 100, completion_tokens: 20, model: 'large-model', response_id: 'first' };
        const record = attachRequestUsage(prefix, initial, { requestId: 'host', iteration: 1, measuredAt: 1 });
        expect(readMeasuredRequestUsage(initial, record)).toEqual(record);
        expect(readMeasuredRequestUsage({ ...initial, prompt_tokens: 150 }, record)).toBeUndefined();
        expect(readMeasuredRequestUsage({ ...initial, response_id: 'second' }, record)).toBeUndefined();
        expect(readMeasuredRequestUsage({ ...initial, model: 'other' }, record)).toBeUndefined();
        expect(readMeasuredRequestUsage(initial, { ...record, prefix_hash: '' })).toBeUndefined();
    });

});
