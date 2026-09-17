import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTAINMENT_BUDGETS } from '~~/shared/plugins/isolation/budgets';
import {
    createPluginAiCompleteMethod,
    type PluginAiCompletionResult,
    type PluginAiProvider,
} from '../plugin-invocation';
import { PluginAiGovernor } from '~~/shared/plugins/ai/plugin-usage';
import { createOpenRouterPluginProvider } from '../openrouter-client';

function fakeProvider(
    result: Partial<PluginAiCompletionResult> = {}
): PluginAiProvider & { calls: Array<Record<string, unknown>> } {
    const calls: Array<Record<string, unknown>> = [];
    return {
        calls,
        async complete(request, context) {
            calls.push({ request, context });
            return {
                text: 'summary',
                model: request.model,
                promptTokens: 10,
                completionTokens: 20,
                spendUsd: 0.0001,
                ...result,
            };
        },
    };
}

const context = {
    pluginId: 'example.plugin',
    workspaceId: 'ws_1',
    generation: 2,
    requestId: 'rpc-1',
    signal: new AbortController().signal,
    deadlineMs: DEFAULT_CONTAINMENT_BUDGETS.defaultCallDeadlineMs,
};

/** Trusted host prices: a model without one is refused, never assumed free. */
const PRICES = {
    'openai/gpt-4o-mini': { promptPerMillion: 1, completionPerMillion: 2 },
};

describe('plugin AI invocation (4.11)', () => {
    it('attributes usage to the plugin and returns no credential', async () => {
        const provider = fakeProvider();
        const spec = createPluginAiCompleteMethod({ provider, prices: PRICES });
        const result = (await spec.handler(
            { model: 'openai/gpt-4o-mini', prompt: 'Summarize this' },
            context
        )) as { text: string; usage: { spendUsd: number } };

        expect(spec.method).toBe('ai.complete');
        expect(spec.grant).toBe('network.http');
        expect(result.text).toBe('summary');
        expect(result.usage.spendUsd).toBeCloseTo(0.0001);
        expect(provider.calls).toHaveLength(1);
        // The provider call receives a bounded output ceiling and a deadline.
        expect(provider.calls[0]!.request).toMatchObject({
            model: 'openai/gpt-4o-mini',
            maxOutputTokens: DEFAULT_CONTAINMENT_BUDGETS.maxAiOutputTokens,
        });
        expect(
            (provider.calls[0]!.context as { timeoutMs: number }).timeoutMs
        ).toBe(DEFAULT_CONTAINMENT_BUDGETS.defaultCallDeadlineMs);
        expect(JSON.stringify(result)).not.toContain('Bearer');
    });

    it('refuses a model outside the plugin allowlist', async () => {
        const spec = createPluginAiCompleteMethod({
            provider: fakeProvider(),
            prices: PRICES,
            allowedModels: ['openai/gpt-4o-mini'],
        });
        await expect(
            spec.handler({ model: 'expensive/frontier', prompt: 'hi' }, context)
        ).rejects.toMatchObject({ rpcCode: 'policy-denied' });
    });

    it('refuses a call whose spend would exceed the activation budget', async () => {
        const spec = createPluginAiCompleteMethod({
            provider: fakeProvider({ spendUsd: 5 }),
            prices: PRICES,
        });
        await expect(
            spec.handler({ model: 'openai/gpt-4o-mini', prompt: 'hi' }, context)
        ).rejects.toMatchObject({ rpcCode: 'budget-exceeded' });
    });

    it('refuses a completion above the output ceiling', async () => {
        const spec = createPluginAiCompleteMethod({
            provider: fakeProvider({ completionTokens: 999_999 }),
            prices: PRICES,
        });
        await expect(
            spec.handler({ model: 'openai/gpt-4o-mini', prompt: 'hi' }, context)
        ).rejects.toMatchObject({ rpcCode: 'budget-exceeded' });
    });

    it('rejects non-string parameters and empty prompts', async () => {
        const spec = createPluginAiCompleteMethod({ provider: fakeProvider(), prices: PRICES });
        await expect(spec.handler({ model: 7, prompt: 'hi' }, context)).rejects.toMatchObject({
            rpcCode: 'policy-denied',
        });
        await expect(
            spec.handler({ model: 'openai/gpt-4o-mini', prompt: '' }, context)
        ).rejects.toMatchObject({ rpcCode: 'policy-denied' });
    });

    it('records attributed usage and reserves spend before dispatch', () => {
        const governor = new PluginAiGovernor({
            budgets: DEFAULT_CONTAINMENT_BUDGETS,
            prices: { m: { promptPerMillion: 100, completionPerMillion: 100 } },
        });
        const admission = governor.admit({ model: 'm', prompt: 'hi' });
        expect(admission.status).toBe('admitted');
        if (admission.status !== 'admitted') return;
        // Worst case is reserved before the paid call happens.
        expect(governor.committedUsd).toBeGreaterThan(0);
        const settled = admission.settle({ spendUsd: 0.01, completionTokens: 5 });
        expect(settled.ok).toBe(true);
        expect(governor.committedUsd).toBeCloseTo(0, 6);
        governor.record({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
            model: 'm',
            promptTokens: 5,
            completionTokens: 5,
            spendUsd: 0.01,
            at: 1,
        });
        expect(governor.usage[0]).toMatchObject({ pluginId: 'example.plugin', spendUsd: 0.01 });
        expect(governor.disclosure('Example plugin')).toContain('billed to that account');
    });

    it('refuses a model with no trusted price and releases slots on failure', () => {
        const governor = new PluginAiGovernor({
            budgets: { ...DEFAULT_CONTAINMENT_BUDGETS, maxConcurrentCalls: 1 },
            prices: PRICES,
        });
        expect(governor.admit({ model: 'unknown/model', prompt: 'hi' })).toMatchObject({
            status: 'refused',
            code: 'price-unavailable',
        });

        const first = governor.admit({ model: 'openai/gpt-4o-mini', prompt: 'hi' });
        expect(first.status).toBe('admitted');
        if (first.status !== 'admitted') return;
        // The slot is held while the call is in flight ...
        expect(governor.admit({ model: 'openai/gpt-4o-mini', prompt: 'hi' })).toMatchObject({
            status: 'refused',
            code: 'budget-exceeded',
        });
        // ... and released exactly once when the provider fails.
        first.settle();
        expect(governor.admit({ model: 'openai/gpt-4o-mini', prompt: 'hi' })).toMatchObject({
            status: 'admitted',
        });
    });

    it('stops admitting once committed spend reaches the activation ceiling', () => {
        const governor = new PluginAiGovernor({
            budgets: { ...DEFAULT_CONTAINMENT_BUDGETS, maxAiSpendUsd: 0.01 },
            prices: { m: { promptPerMillion: 1_000_000, completionPerMillion: 1_000_000 } },
        });
        // A reservation larger than the whole ceiling is refused before dispatch.
        expect(governor.admit({ model: 'm', prompt: 'hi', maxOutputTokens: 4096 })).toMatchObject({
            status: 'refused',
            code: 'budget-exceeded',
        });
    });

    it('keeps the OpenRouter credential on the host path and bounds the request', async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: 'ok' } }],
                    usage: { prompt_tokens: 100, completion_tokens: 200 },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
            )
        );
        const provider = createOpenRouterPluginProvider({
            apiKey: 'sk-or-host-key',
            baseUrl: 'https://openrouter.ai/api/v1',
            fetchImpl: fetchImpl as unknown as typeof fetch,
            prices: { 'openai/gpt-4o-mini': { promptPerMillion: 1, completionPerMillion: 2 } },
        });

        const result = await provider.complete(
            { model: 'openai/gpt-4o-mini', prompt: 'hi', maxOutputTokens: 64 },
            { timeoutMs: 500 }
        );
        expect(result).toMatchObject({ text: 'ok', completionTokens: 200 });
        expect(result.spendUsd).toBeCloseTo(0.0005, 6);

        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-or-host-key');
        expect(JSON.parse(String(init.body))).toMatchObject({ max_tokens: 64 });
        expect(init.redirect).toBeUndefined();
    });

    it('refuses to spend on a model with no trusted price', async () => {
        const provider = createOpenRouterPluginProvider({
            apiKey: 'sk-or-host-key',
            baseUrl: 'https://openrouter.ai/api/v1',
            fetchImpl: vi.fn() as unknown as typeof fetch,
            prices: {},
        });
        await expect(
            provider.complete({ model: 'unknown/model', prompt: 'hi' }, { timeoutMs: 100 })
        ).rejects.toThrow(/No trusted price/);
    });

    it('fails closed when the provider reports no usable usage', async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        const provider = createOpenRouterPluginProvider({
            apiKey: 'sk-or-host-key',
            baseUrl: 'https://openrouter.ai/api/v1',
            fetchImpl: fetchImpl as unknown as typeof fetch,
            prices: { 'openai/gpt-4o-mini': { promptPerMillion: 1, completionPerMillion: 2 } },
        });
        await expect(
            provider.complete({ model: 'openai/gpt-4o-mini', prompt: 'hi' }, { timeoutMs: 100 })
        ).rejects.toThrow(/usable token usage/);
    });

    it('fails when no host credential is configured', async () => {
        const provider = createOpenRouterPluginProvider({
            apiKey: '',
            baseUrl: 'https://openrouter.ai/api/v1',
            prices: {},
        });
        await expect(
            provider.complete({ model: 'm', prompt: 'p' }, { timeoutMs: 100 })
        ).rejects.toThrow(/credential is configured/);
    });
});
