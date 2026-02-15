import { describe, expect, it } from 'vitest';
import {
    redactForBackgroundLog,
} from '../logging';

describe('background logging redaction', () => {
    it('redacts known secret keys recursively', () => {
        const input = {
            apiKey: 'sk-should-not-appear',
            nested: {
                refreshToken: 'refresh-token',
                password: 'hunter2',
            },
            list: [
                { authorization: 'Bearer abc.def.ghi' },
                { token_hint: 'opaque-token' },
            ],
        };

        const redacted = redactForBackgroundLog(input);
        expect(redacted.apiKey).toBe('<redacted>');
        expect(redacted.nested.refreshToken).toBe('<redacted>');
        expect(redacted.nested.password).toBe('<redacted>');
        expect(redacted.list[0]?.authorization).toBe('<redacted>');
        expect(redacted.list[1]?.token_hint).toBe('<redacted>');
    });

    it('redacts secret-like token strings even when key is not secret-like', () => {
        const input = {
            args: 'Authorization: Bearer abc.def.ghi',
            note: 'openrouter key sk-1234567890abcdefghijkl',
            session:
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signatureValue',
        };

        const redacted = redactForBackgroundLog(input);
        expect(redacted.args).toContain('Bearer <redacted>');
        expect(redacted.note).toContain('<redacted-key>');
        expect(redacted.session).toContain('<redacted-jwt>');
    });
});
