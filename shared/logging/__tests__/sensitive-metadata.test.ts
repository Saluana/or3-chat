import { describe, expect, it } from 'vitest';
import { sensitiveValueMetadata } from '../sensitive-metadata';

describe('sensitiveValueMetadata', () => {
    it('counts UTF-8 bytes and returns a stable correlation fingerprint without content', () => {
        const value = 'password=秘密🔑';
        const first = sensitiveValueMetadata(value);
        expect(first.utf8Bytes).toBe(new TextEncoder().encode(value).byteLength);
        expect(first.fingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
        expect(JSON.stringify(first)).not.toContain('秘密');
        expect(sensitiveValueMetadata(value)).toEqual(first);
    });
});

// This helper owns lifecycle console output; the reporter tests cannot reach it.
it('removes credentials embedded in nested messages before bounding diagnostic output', async () => {
    const { redactDiagnosticDetails } = await import('../sensitive-metadata');
    const output = JSON.stringify(redactDiagnosticDetails({
        error: new Error('password=hunter2 /private/file.ts:1'),
        nested: { message: '{"token":"secret123"} Bearer opaque-token-value', apiKey: 'private-key-value' },
        long: 'x'.repeat(10000),
    }));
    expect(output).not.toMatch(/hunter2|secret123|opaque-token-value|private-key-value|private\/file/);
    expect(output.length).toBeLessThan(1000);
});
