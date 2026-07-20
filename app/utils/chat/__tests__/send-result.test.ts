import { describe, expect, it } from 'vitest';
import { hasDurableSendAcceptance, type SendResult } from '../types';

describe('hasDurableSendAcceptance', () => {
    it.each<SendResult>([
        { status: 'rejected', reason: 'busy' },
        {
            status: 'failed',
            requestId: 'r1',
            reason: 'stream_error',
            error: 'failed before persistence',
        },
    ])('keeps the composer draft for $status without a durable user row', (result) => {
        expect(hasDurableSendAcceptance(result)).toBe(false);
    });

    it.each<SendResult>([
        {
            status: 'complete',
            requestId: 'r1',
            userMessageId: 'u1',
            assistantMessageId: 'a1',
        },
        {
            status: 'failed',
            requestId: 'r2',
            reason: 'stream_error',
            error: 'failed after persistence',
            userMessageId: 'u2',
        },
        {
            status: 'detached',
            requestId: 'r3',
            reason: 'detached',
            userMessageId: 'u3',
        },
    ])('allows composer cleanup for durable $status results', (result) => {
        expect(hasDurableSendAcceptance(result)).toBe(true);
    });
});
