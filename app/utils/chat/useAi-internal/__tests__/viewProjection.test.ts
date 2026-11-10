import { describe, expect, it, vi } from 'vitest';
import { createStreamAccumulator } from '~/composables/chat/useStreamAccumulator';
import type { ChatMessage } from '~/utils/chat/types';
import { createChatViewProjection } from '../viewProjection';

const history = (): ChatMessage[] => [
    { id: 'user', role: 'user', content: 'hello', file_hashes: '["hash"]' },
    { id: 'assistant', role: 'assistant', content: 'answer', data: {
        usage: { prompt_tokens: 10, completion_tokens: 2, model: 'model', request_id: 'req', iteration: 0, measured_at: 1, prefix_message_count: 1, prefix_hash: 'p', configuration_hash: 'c', input_estimate_tokens: 9 },
        tool_calls: [{ id: 'call', name: 'search', status: 'complete', result: 'found' }],
        tool_cards: { call: { v: 1, updated_at: 1, state: { expanded: true } } },
    } },
    { id: 'result', role: 'tool', content: 'found', tool_call_id: 'call', data: { parent_assistant_id: 'assistant' } },
];

// A refresh can clone nested values, change just one row, drop optional fields,
// or rebuild tool-result navigation. Each must preserve the other mounted rows.
describe('canonical history projection', () => {
    it('retains unchanged cloned rows, including expanded UI state and tool associations', () => {
        const rows = history();
        const view = createChatViewProjection(rows, () => { throw new Error('unused'); });
        const before = [...view.messages.value];
        (before[1] as typeof before[1] & { _expanded: boolean })._expanded = true;
        view.replaceCanonicalHistory(structuredClone(rows));
        expect(view.messages.value.map(row => row.id)).toEqual(['user', 'assistant']);
        expect(view.messages.value[1]?.toolResultMessageIds).toEqual(['result']);
        expect(view.messages.value.filter((row, i) => row === before[i])).toHaveLength(2);
        expect((view.messages.value[1] as typeof before[1] & { _expanded: boolean })._expanded).toBe(true);
    });

    it.each(['text', 'usage', 'tool', 'card', 'removed'] as const)('replaces only the row with changed %s', (change) => {
        const rows = history();
        const view = createChatViewProjection(rows, () => { throw new Error('unused'); });
        const before = [...view.messages.value];
        const next = structuredClone(rows);
        const assistant = next[1]!;
        if (change === 'text') assistant.content = 'changed';
        if (change === 'usage') assistant.data!.usage!.prompt_tokens++;
        if (change === 'tool') (assistant.data!.tool_calls as unknown[]).push({ id: 'other', name: 'read', status: 'pending' });
        if (change === 'card') assistant.data!.tool_cards = { call: { v: 1, updated_at: 1, state: { expanded: false } } };
        if (change === 'removed') delete assistant.data!.usage;
        view.replaceCanonicalHistory(next);
        expect(view.messages.value[0]).toBe(before[0]);
        expect(view.messages.value[1]).not.toBe(before[1]);
        expect(view.messages.value[1]?.toolResultMessageIds).toEqual(['result']);
    });
});

// Background snapshots may arrive faster than the accumulator publishes frames.
it('reconciles consecutive background snapshots and true replacements', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    try {
        const acc = createStreamAccumulator();
        const view = createChatViewProjection([], () => acc);
        view.tailAssistant.value = { id: 'tail', role: 'assistant', text: '' } as any;
        const initial = 'a'.repeat(20_000);
        acc.hydrate({ text: initial });
        view.syncTailAccumulator('tail', initial + 'b', 'b');
        vi.advanceTimersByTime(16);
        view.syncTailAccumulator('tail', initial + 'bc', 'c');
        view.syncTailAccumulator('tail', initial + 'bcd', 'd');
        expect(acc.state.text).toBe(initial + 'b');
        vi.advanceTimersByTime(100);
        expect(acc.state.text).toBe(initial + 'bcd');
        view.syncTailAccumulator('tail', 'replacement', 'replacement');
        view.syncTailAccumulator('tail', 'replacement!', '!');
        acc.finalize();
        expect(acc.state.text).toBe('replacement!');
        acc.reset();
        view.syncTailAccumulator('tail', 'new', 'new');
        acc.finalize();
        expect(acc.state.text).toBe('new');
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

it('publishes background reasoning snapshots without losing queued text', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    try {
        const acc = createStreamAccumulator();
        const view = createChatViewProjection([], () => acc);
        const initial = 'a'.repeat(20_000);
        view.tailAssistant.value = { id: 'tail', role: 'assistant', text: initial, reasoning_text: 'old' } as any;
        acc.hydrate({ text: initial, reasoningText: 'old' });
        view.syncTailAccumulator('tail', initial + 'b', 'b');
        vi.advanceTimersByTime(16);
        view.syncTailAccumulator('tail', initial + 'bc', 'c');
        view.tailAssistant.value!.reasoning_text = 'old plus';
        view.syncTailAccumulator('tail', initial + 'bc', '');
        vi.advanceTimersByTime(100);
        expect(acc.state.reasoningText).toBe('old plus');
        expect(acc.state.text).toBe(initial + 'bc');
        view.tailAssistant.value!.reasoning_text = 'old plus more';
        view.syncTailAccumulator('tail', initial + 'bcd', 'd');
        vi.advanceTimersByTime(100);
        expect(acc.state.reasoningText).toBe('old plus more');
        expect(acc.state.text).toBe(initial + 'bcd');
        view.tailAssistant.value!.reasoning_text = 'replacement reason';
        view.syncTailAccumulator('tail', 'replacement', 'replacement');
        acc.finalize();
        expect(acc.state.text).toBe('replacement');
        expect(acc.state.reasoningText).toBe('replacement reason');
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});
