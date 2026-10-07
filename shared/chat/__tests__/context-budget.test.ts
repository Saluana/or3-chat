import { describe, expect, it } from 'vitest';
import { admitChatContext, estimateChatRequest } from '../context-budget';

describe('provider context admission', () => {
    const model = { context_length: 1_000_000, top_provider: { context_length: 128_000, max_completion_tokens: 65_536 } };
    it('uses the full advertised model window and only the remaining actual reply capacity', () => {
        expect(admitChatContext({ model, inputTokens: 970_000 })).toMatchObject({ ok: true,
            budget: { model_context_tokens: 1_000_000, effective_context_tokens: 1_000_000,
                available_completion_tokens: 30_000, requested_completion_tokens: null, limited_by: 'model' } });
    });
    it('rejects total-window overflow and a request that leaves no positive reply capacity', () => {
        expect(admitChatContext({ model, inputTokens: 1_000_000 })).toMatchObject({ ok: false, code: 'context_full' });
        expect(admitChatContext({ model, inputTokens: 990_000, requestedCompletionTokens: 16_000 })).toMatchObject({ ok: false, code: 'context_full' });
    });
    it('preserves an explicit user maximum and requires a requested reply to fit inside it', () => {
        expect(admitChatContext({ model, inputTokens: 19_000, userMaxContextTokens: 20_000,
            requestedCompletionTokens: 2_048 })).toMatchObject({ ok: false, code: 'context_full',
            budget: { effective_context_tokens: 20_000, user_max_context_tokens: 20_000, limited_by: 'user' } });
        expect(admitChatContext({ model, inputTokens: 19_000, userMaxContextTokens: 20_000 })).toMatchObject({ ok: true,
            budget: { available_completion_tokens: 1_000 } });
    });
    it('enforces the actual provider output maximum without substituting a smaller requested setting', () => {
        expect(admitChatContext({ model, inputTokens: 100, requestedCompletionTokens: 70_000 })).toMatchObject({ ok: false, code: 'invalid_output_limit' });
        expect(admitChatContext({ model, inputTokens: 100, requestedCompletionTokens: 0 })).toMatchObject({ ok: false, code: 'invalid_output_limit' });
        expect(admitChatContext({ model, inputTokens: 100, requestedCompletionTokens: 40_000 })).toMatchObject({ ok: true,
            budget: { requested_completion_tokens: 40_000, available_completion_tokens: 65_536 } });
    });
    // Live: Kimi K2.5 with tool history at max_tokens 235,929 was routed to
    // hosts that refuse tool use; at 65,536 it was served. The full window
    // also reserved credit a small balance could not cover.
    it('defaults the reply allowance below a very large output window, while an explicit allowance may use it', () => {
        const wide = { context_length: 262_144, top_provider: { context_length: 262_144, max_completion_tokens: 235_929 } };
        expect(admitChatContext({ model: wide, inputTokens: 20_000 })).toMatchObject({ ok: true,
            budget: { model_max_completion_tokens: 235_929, available_completion_tokens: 65_536 } });
        expect(admitChatContext({ model: wide, inputTokens: 20_000, requestedCompletionTokens: 200_000 })).toMatchObject({ ok: true,
            budget: { requested_completion_tokens: 200_000, available_completion_tokens: 235_929 } });
        expect(admitChatContext({ model: wide, inputTokens: 250_000 })).toMatchObject({ ok: true,
            budget: { available_completion_tokens: 12_144 } });
    });
    it('intersects a verified selected-route limit and separate input/output ceilings', () => {
        expect(admitChatContext({ model, inputTokens: 9_000,
            routeLimits: { contextTokens: 64_000, inputTokens: 8_192, outputTokens: 4_096 } })).toMatchObject({ ok: false, code: 'context_full' });
        expect(admitChatContext({ model, inputTokens: 7_000,
            routeLimits: { contextTokens: 64_000, inputTokens: 8_192, outputTokens: 4_096 } })).toMatchObject({ ok: true,
            budget: { effective_context_tokens: 64_000, available_completion_tokens: 4_096 } });
    });
    it('uses a verified selected route output limit instead of an unrelated catalog provider ceiling', () => {
        const catalog = { context_length: 100_000, top_provider: { max_completion_tokens: 4_096 } };
        expect(admitChatContext({ model: catalog, inputTokens: 1_000, requestedCompletionTokens: 8_192,
            routeLimits: { outputTokens: 65_536 } })).toMatchObject({ ok: true, budget: { available_completion_tokens: 65_536 } });
        expect(admitChatContext({ model: catalog, inputTokens: 1_000, requestedCompletionTokens: 70_000,
            routeLimits: { outputTokens: 65_536 } })).toMatchObject({ ok: false, code: 'invalid_output_limit' });
        expect(admitChatContext({ model: catalog, inputTokens: 99_000, requestedCompletionTokens: 8_192,
            routeLimits: { outputTokens: 65_536 } })).toMatchObject({ ok: false, code: 'context_full' });
        expect(admitChatContext({ model: catalog, inputTokens: 1_000, requestedCompletionTokens: 8_192 }))
            .toMatchObject({ ok: false, code: 'invalid_output_limit' });
    });
    it('keeps unavailable/invalid metadata explicit even when a user maximum exists', () => {
        for (const missing of [undefined, {}, { context_length: 0 }, { context_length: -1 }, { context_length: '1000000' }, { context_length: Infinity }]) {
            expect(admitChatContext({ model: missing, inputTokens: 10, userMaxContextTokens: 100_000 })).toEqual({ ok: false, code: 'model_metadata_unavailable' });
        }
        expect(admitChatContext({ model: { top_provider: { context_length: 32_000 } }, inputTokens: 100 })).toMatchObject({ ok: true,
            budget: { model_context_tokens: 32_000 } });
    });
    it('counts tool definitions/calls/results and protocol overhead once without tokenizing media bytes', async () => {
        const counted: string[] = [];
        const estimate = await estimateChatRequest({ countText: async (text) => { counted.push(text); return text.length; },
            messages: [
                { role: 'assistant', content: 'calling', tool_calls: [{ id: 'call-unique', type: 'function', function: { name: 'lookup-unique', arguments: '{"term":"query-unique"}' } }] },
                { role: 'tool', content: 'result-unique', tool_call_id: 'call-unique' },
                { role: 'user', content: [{ type: 'text', text: 'draft-unique' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'a'.repeat(100_000) } }] },
            ], tools: [{ type: 'function', function: { name: 'lookup-unique', description: 'schema-unique', parameters: { type: 'object' } } }],
        });
        expect(counted.join('\n')).not.toContain('data:image');
        expect(counted.join('\n').match(/query-unique/gu)).toHaveLength(1);
        expect(counted.join('\n').match(/result-unique/gu)).toHaveLength(1);
        expect(counted.join('\n').match(/schema-unique/gu)).toHaveLength(1);
        expect(estimate).toMatchObject({ basis: 'estimated', media_cost: 'estimated' });
        expect(estimate.input_tokens).toBeGreaterThan('callingresult-uniquedraft-unique'.length);
    });
    it.each([
        ['openai/gpt-4o', 1024, 1024, 765],
        ['openai/gpt-4.1-mini', 1024, 1024, 1659],
        ['anthropic/claude-sonnet-4.5', 1000, 1000, 1296],
        ['anthropic/claude-opus-4.7', 1920, 1080, 2691],
        ['unknown-model', 1024, 1024, 1200],
        ['openai/gpt-4o', undefined, undefined, 1200],
    ] as const)('estimates image geometry for %s without counting encoded bytes', async (model, width, height, expected) => {
        const estimate = await estimateChatRequest({ model, countText: async () => 0, messages: [{ role: 'user', content: [
            { type: 'image_url', width, height, image_url: { url: 'data:image/png;base64,' + 'a'.repeat(100000) } },
        ] }] });
        expect(estimate).toEqual({ input_tokens: expected, basis: 'estimated', media_cost: 'estimated' });
    });
    it('keeps unmeasured PDF cost unknown', async () => {
        expect(await estimateChatRequest({ countText: async () => 0, messages: [{ role: 'user', content: [{ type: 'file' }] }] }))
            .toEqual({ input_tokens: 0, basis: 'estimated', media_cost: 'unknown' });
    });
});
