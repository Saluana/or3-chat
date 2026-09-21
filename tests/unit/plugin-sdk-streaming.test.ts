import { describe, expect, it } from 'vitest';
import { PluginSseDecoder } from '../../packages/plugin-sdk/src/streaming';

describe('Plugin SDK SSE decoder', () => {
    it('handles split UTF-8, CRLF, multiline data and comments', () => {
        const decoder = new PluginSseDecoder();
        const encoded = new TextEncoder().encode(': heartbeat\r\nid: 42\r\nevent: message\r\ndata: caf\u00e9\r\ndata: next\r\n\r\n');
        const split = encoded.indexOf(0xc3);
        const first = decoder.push(encoded.slice(0, split + 1));
        expect(first).toMatchObject({ ok: true, chunks: [{ kind: 'comment' }] });
        const second = decoder.push(encoded.slice(split + 1));
        expect(second).toMatchObject({
            ok: true,
            chunks: [{ kind: 'data', id: '42', event: 'message', data: 'café\nnext' }],
        });
        expect(decoder.finish()).toEqual({ ok: true, chunks: [] });
    });

    it('bounds lines/events and rejects use after finish', () => {
        const decoder = new PluginSseDecoder({ maxEventBytes: 4 });
        expect(decoder.push('data: abcde\n')).toMatchObject({ ok: false });
        expect(decoder.finish()).toMatchObject({ ok: false, message: 'SSE event is too large' });
        expect(decoder.push('data: late\n')).toMatchObject({ ok: false });
    });

    it('fails closed for invalid UTF-8 and an incomplete oversized line', () => {
        const invalid = new PluginSseDecoder();
        expect(invalid.push(new Uint8Array([0xc3, 0x28]))).toMatchObject({
            ok: false,
            message: 'SSE input is not valid UTF-8',
        });
        expect(invalid.finish()).toEqual({ ok: false, message: 'SSE input is not valid UTF-8' });

        const incomplete = new PluginSseDecoder();
        expect(incomplete.push(new Uint8Array(70_000).fill(0x78))).toMatchObject({
            ok: false,
            message: 'SSE line is too large',
        });
        expect(incomplete.push('data: late\n')).toEqual({ ok: false, message: 'SSE line is too large' });
    });
});
