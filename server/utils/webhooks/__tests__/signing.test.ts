/* @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { buildDeliveryHeaders, signPayload } from '../signing';

describe('webhook signing', () => {
    it('signs the exact raw payload bytes', () => {
        const compact = signPayload('{"ok":true}', 'test-secret', 1_700_000_000);
        const spaced = signPayload('{ "ok": true }', 'test-secret', 1_700_000_000);
        const tampered = signPayload('{"ok":false}', 'test-secret', 1_700_000_000);

        expect(spaced).not.toBe(compact);
        expect(tampered).not.toBe(compact);
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
