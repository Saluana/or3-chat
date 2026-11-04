import { describe, expect, it, vi } from 'vitest';
import { createAiRuntime } from '../runtime';

// Deliberately not OpenRouter-compatible: IDs are opaque and the response is
// one JSON object rather than an OpenAI-shaped SSE stream.
function fixtureAdapter() {
    return {
        id: 'fixture',
        prepare(request: { model: { routerId: string; modelId: string }; messages: { role: string; content: string }[];
            routingOption?: string }) {
            if (request.model.routerId !== 'fixture' || request.routingOption)
                throw new Error('Unsupported router option');
            return { model: request.model, body: { id: request.model.modelId, input: request.messages } };
        },
        async *decodeStream(response: Response) {
            const frame = await response.json() as { answer: string };
            yield { type: 'text' as const, text: frame.answer };
            yield { type: 'done' as const };
        },
    };
}

describe('AI runtime adapter contract', () => {
    it('preserves opaque model IDs and decodes the selected adapter response', async () => {
        const open = vi.fn(async (_prepared: { body: unknown }) => Response.json({ answer: 'fixture response' }));
        const runtime = createAiRuntime(fixtureAdapter(), open);
        const events = [];
        for await (const event of runtime.stream({ model: { routerId: 'fixture', modelId: 'vendor/model:online:free' },
            messages: [{ role: 'user', content: 'Question' }] })) events.push(event);
        expect(open).toHaveBeenCalledOnce();
        expect(open.mock.calls[0]![0].body).toEqual({ id: 'vendor/model:online:free',
            input: [{ role: 'user', content: 'Question' }] });
        expect(events).toEqual([{ type: 'text', text: 'fixture response' }, { type: 'done' }]);
    });

    it('rejects unsupported adapter options before opening a provider connection', async () => {
        const open = vi.fn(async (_prepared: { body: unknown }) => Response.json({ answer: 'unexpected' }));
        const runtime = createAiRuntime(fixtureAdapter(), open);
        await expect((async () => {
            for await (const _event of runtime.stream({ model: { routerId: 'fixture', modelId: 'native:model' },
                messages: [{ role: 'user', content: 'Question' }], routingOption: 'nitro' })) { /* consume */ }
        })()).rejects.toThrow('Unsupported router option');
        expect(open).not.toHaveBeenCalled();
    });
});
