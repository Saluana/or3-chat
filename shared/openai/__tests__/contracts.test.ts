import { describe, expect, it } from 'vitest';
import { mapOpenAiModels } from '../models';
import { encodeOpenAiRequest } from '../adapter';
import { attachRequestUsage, captureUsagePrefix, estimateMeasuredChatRequest } from '../../chat/request-usage';
import { normalizeOpenAiUsage } from '../../ai/events';
import { MAX_SSE_EVENT_BYTES } from '../../chat/tool-limits';
import { decodeOpenAiResponseStream, encodeOpenAiResponseRequest } from '../responses';

const responseFrame = (event: object, separator = '\n') =>
    `data: ${JSON.stringify(event)}${separator}${separator}`;
const completedResponse = { type: 'response.completed', response: { output: [] } };

async function readResponseEvents(chunks: Uint8Array[]) {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
    });
    const events = [];
    for await (const event of decodeOpenAiResponseStream(stream)) events.push(event);
    return events;
}

// The provider owns SSE framing: transport chunk boundaries do not correspond
// to events or Unicode characters, and the size limit applies to each event.
describe('OpenAI Responses stream contract', () => {
    it('decodes CRLF event boundaries and Unicode split across network chunks', async () => {
        const encoded = new TextEncoder().encode(responseFrame({ type: 'response.output_text.delta', delta: 'Hi 🐦' }, '\r\n')
            + responseFrame(completedResponse, '\r\n'));
        const chunks = Array.from(encoded, byte => Uint8Array.of(byte));
        expect(await readResponseEvents(chunks)).toEqual([{ type: 'text', text: 'Hi 🐦' }, { type: 'done' }]);
    });

    it('limits individual events without rejecting several valid events in one chunk', async () => {
        const padding = 'a'.repeat(Math.floor(MAX_SSE_EVENT_BYTES / 2) + 100);
        const event = responseFrame({ type: 'response.in_progress', padding });
        expect(await readResponseEvents([new TextEncoder().encode(event + event + responseFrame(completedResponse))]))
            .toEqual([{ type: 'done' }]);
        await expect(readResponseEvents([new TextEncoder().encode(responseFrame({
            type: 'response.in_progress', padding: 'a'.repeat(MAX_SSE_EVENT_BYTES),
        }))])).rejects.toThrow('exceeds the size limit');
    });

    it('surfaces provider error messages', async () => {
        await expect(readResponseEvents([new TextEncoder().encode(responseFrame({ type: 'error', message: 'Provider overloaded' }))]))
            .rejects.toThrow('Provider overloaded');
    });

    it('ends after a terminal response', async () => {
        expect(await readResponseEvents([new TextEncoder().encode(responseFrame(completedResponse)
            + responseFrame({ type: 'response.output_text.delta', delta: 'late text' }))])).toEqual([{ type: 'done' }]);
    });

    it('rejects an interrupted response without a terminal event', async () => {
        await expect(readResponseEvents([new TextEncoder().encode(responseFrame({ type: 'response.output_text.delta', delta: 'partial' }))]))
            .rejects.toThrow('ended before completion');
    });
});

// Contracts: endpoint capabilities and limits must prevent rejected requests;
// selected identity must permit reuse of the provider's measured prefix.
describe('OpenAI endpoint contracts', () => {
    it('retains structured output, sampling, and explicitly strict tool contracts', () => {
        const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
        const wire = encodeOpenAiResponseRequest(encodeOpenAiRequest({ model: '@openai/gpt-4.1', messages: [], stream: true,
            temperature: 0, top_p: 0.5, response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema } },
            tools: [{ type: 'function', function: { name: 'read_data', description: 'Read data', strict: true, parameters: schema } }] }));
        expect(wire).toMatchObject({ temperature: 0, top_p: 0.5,
            text: { format: { type: 'json_schema', name: 'reply', strict: true, schema } }, tools: [{ name: 'read_data', strict: true }] });
        expect(encodeOpenAiResponseRequest({ model: 'gpt-4.1', response_format: { type: 'json_object' } }))
            .toMatchObject({ text: { format: { type: 'json_object' } } });
    });
    it('uses documented capabilities and capacities for current models', () => {
        const [astra, turbo] = mapOpenAiModels([{ id: 'gpt-6-astra' }, { id: 'gpt-4-turbo' }]);
        expect(astra!.context_length).toBe(1_050_000);
        expect(astra!.supported_parameters).toContain('tools');
        expect(turbo!.top_provider!.max_completion_tokens).toBe(4096);
        expect(encodeOpenAiRequest({ model: '@openai/gpt-6-astra', messages: [], reasoning: { effort: 'none' } }).reasoning_effort).toBe('low');
    });
    it('preserves supported effort levels and the GPT-5.4 context window', () => {
        const [flagship, astra, legacy, newer, terra] = mapOpenAiModels([
            { id: 'gpt-5.4' }, { id: 'gpt-6-astra' }, { id: 'gpt-5.1' }, { id: 'gpt-5.6-terra' }, { id: 'gpt-6.1-terra' },
        ]);
        expect(flagship!.context_length).toBe(1_050_000);
        expect(newer!.context_length).toBe(1_050_000);
        expect(newer!.reasoning!.supported_efforts).toContain('max');
        expect(terra!.reasoning!.supported_efforts).toContain('max');
        expect(astra!.reasoning!.supported_efforts).toContain('max');
        expect(encodeOpenAiRequest({ model: astra!.id, messages: [], reasoning: { effort: 'max' } }).reasoning_effort).toBe('max');
        expect(encodeOpenAiRequest({ model: legacy!.id, messages: [], reasoning: { effort: 'xhigh' } }).reasoning_effort).toBe('high');
    });
    it('retains the selected model identity for measured usage', async () => {
        const input = { model: '@openai/gpt-5.4-mini', messages: [{ role: 'user', content: 'Hi' }], countText: async (s: string) => s.length };
        const prefix = await captureUsagePrefix(input);
        const usage = normalizeOpenAiUsage({ prompt_tokens: 100, completion_tokens: 3, model: 'gpt-5.4-mini-2026-03-17' }, input.model);
        const recorded = attachRequestUsage(prefix, usage, { requestId: 'request', iteration: 1, measuredAt: Date.now() });
        expect((await estimateMeasuredChatRequest({ ...input, usage: recorded })).basis).toBe('measured-prefix');
    });
    it('does not advertise unknown model capacities', () => {
        expect(mapOpenAiModels([{ id: 'gpt-9-unknown' }, { id: 'o99-unverified' }])).toEqual([]);
        expect(mapOpenAiModels([{ id: 'gpt-4o' }, { id: 'gpt-4o-mini-2024-07-18' }])
            .map(model => model.top_provider!.max_completion_tokens)).toEqual([16_384, 16_384]);
    });
});

it('admits the OpenAI-visible options without counting OpenRouter extensions', async () => {
    const { encodeProviderRequest } = await import('../../ai/provider-body');
    const projected = encodeProviderRequest({ model: '@openai/gpt-5.4-mini', messages: [{ role: 'user', content: 'Hi' }],
        stream: true, modalities: ['text'], reasoning: { effort: 'low' }, max_tokens: 200 });
    expect(projected).not.toHaveProperty('modalities');
    expect(projected).toHaveProperty('reasoning_effort', 'low');
    expect(projected).toHaveProperty('max_tokens', 200);
    expect(encodeOpenAiRequest(projected).reasoning_effort).toBe('low');
});
