/* @vitest-environment node */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDeliveryHeaders, signPayload } from '../signing';

describe('webhook signing', () => {
    it('is deterministic for the same inputs', () => {
        const signatureA = signPayload('{"ok":true}', 'test-secret', 1_700_000_000);
        const signatureB = signPayload('{"ok":true}', 'test-secret', 1_700_000_000);

        expect(signatureA).toBe(signatureB);
    });

    it('changes when the timestamp changes', () => {
        const signatureA = signPayload('{"ok":true}', 'test-secret', 1_700_000_000);
        const signatureB = signPayload('{"ok":true}', 'test-secret', 1_700_000_001);

        expect(signatureA).not.toBe(signatureB);
    });

    it('uses the timestamp prefix in the signed content', () => {
        const body = '{"ok":true}';
        const timestamp = 1_700_000_000;
        const expected = createHmac('sha256', 'test-secret')
            .update(`${timestamp}.${body}`)
            .digest('hex');

        expect(signPayload(body, 'test-secret', timestamp)).toBe(`sha256=${expected}`);
    });

    it('builds the expected delivery headers', () => {
        const headers = buildDeliveryHeaders(
            'thread.created',
            'evt_123',
            'sha256=abc123',
            1_700_000_000
        );

        expect(headers).toEqual({
            'Content-Type': 'application/json',
            'X-OR3-Event': 'thread.created',
            'X-OR3-Signature': 'sha256=abc123',
            'X-OR3-Event-ID': 'evt_123',
            'X-OR3-Timestamp': '1700000000',
            'User-Agent': 'OR3-Webhooks/1.0',
        });
    });
});
