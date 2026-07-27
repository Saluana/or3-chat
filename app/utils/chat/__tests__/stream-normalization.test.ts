import { describe, expect, it } from 'vitest';
import {
    createContinuationDeltaNormalizer,
    normalizeStreamingMessage,
} from '../messages';

describe('stream message normalization', () => {
    it('canonicalizes content, reasoning, duplicate tools, and malformed tool chunks', () => {
        const normalized = normalizeStreamingMessage({
            content: 'legacy text',
            reasoning_text: 'legacy reasoning',
            data: {
                content: 'stored text',
                reasoning_text: 'stored reasoning',
                tool_calls: [
                    null,
                    'bad',
                    { id: '', name: 'missing-id' },
                    {
                        id: 'call-1',
                        type: 'function',
                        function: {
                            name: 'lookup',
                            arguments: '{"q":"old"}',
                        },
                    },
                    {
                        id: 'call-1',
                        name: 'lookup',
                        args: '{"q":"new"}',
                        status: 'complete',
                        result: 'answer',
                    },
                ],
            },
        });

        expect(normalized).toEqual({
            text: 'stored text',
            reasoningText: 'stored reasoning',
            toolCalls: [
                {
                    id: 'call-1',
                    name: 'lookup',
                    args: '{"q":"new"}',
                    status: 'complete',
                    result: 'answer',
                    error: undefined,
                    fingerprint: undefined,
                },
            ],
        });
    });

    it('removes a fragmented continuation marker and replayed suffix once', () => {
        const normalizer = createContinuationDeltaNormalizer(
            'The quick brown fox'
        );
        const chunks = [
            normalizer.push('>'),
            normalizer.push('>brown fox'),
            normalizer.push(' jumps'),
            normalizer.finish(),
        ];

        expect(`The quick brown fox${chunks.join('')}`).toBe(
            'The quick brown fox jumps'
        );
    });

    it('ignores malformed deltas and flushes a short prefix-less final chunk', () => {
        const normalizer = createContinuationDeltaNormalizer('Done.');

        expect(normalizer.push(null)).toBe('');
        expect(normalizer.push({ text: 'bad' })).toBe('');
        expect(normalizer.push('!')).toBe('');
        expect(normalizer.finish()).toBe('!');
    });

    it('adds continuation boundary spacing exactly once across chunks', () => {
        const normalizer = createContinuationDeltaNormalizer('Hello');

        expect(normalizer.push('>>world')).toBe(' world');
        expect(normalizer.push(' again')).toBe(' again');
        expect(normalizer.finish()).toBe('');
    });
});
