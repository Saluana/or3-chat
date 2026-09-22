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

    it('supports CR-only line endings', () => {
        const decoder = new PluginSseDecoder();
        expect(decoder.push('data: x\r\r')).toEqual({
            ok: true,
            chunks: [{ kind: 'data', data: 'x' }],
        });
        expect(decoder.finish()).toEqual({ ok: true, chunks: [] });
    });

    it('emits a trailing CR immediately and suppresses only the following LF', () => {
        const decoder = new PluginSseDecoder();
        expect(decoder.push('data: first\r\n\r')).toMatchObject({ chunks: [{ data: 'first' }] });
        expect(decoder.push('\ndata: second\r\r')).toMatchObject({ chunks: [{ data: 'second' }] });
        expect(decoder.finish()).toMatchObject({ chunks: [] });
    });

    it('decodes a large LF-only batch without losing lines', () => {
        const decoder = new PluginSseDecoder();
        const result = decoder.push(': heartbeat\n'.repeat(8000) + 'data: done\n\n');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.chunks).toHaveLength(8001);
            expect(result.chunks.at(-1)).toEqual({ kind: 'data', data: 'done' });
        }
    });

    it('handles a CRLF pair split across chunks', () => {
        const decoder = new PluginSseDecoder();
        expect(decoder.push('data: split\r')).toEqual({ ok: true, chunks: [] });
        const second = decoder.push('\n\r\n');
        expect(second).toEqual({ ok: true, chunks: [{ kind: 'data', data: 'split' }] });
        expect(decoder.finish()).toEqual({ ok: true, chunks: [] });
    });

    it('discards unterminated event data at EOF', () => {
        const decoder = new PluginSseDecoder();
        expect(decoder.push('data: incomplete')).toEqual({ ok: true, chunks: [] });
        expect(decoder.finish()).toEqual({ ok: true, chunks: [] });

        const terminated = new PluginSseDecoder();
        expect(terminated.push('data: no-blank-line\n')).toEqual({ ok: true, chunks: [] });
        expect(terminated.finish()).toEqual({ ok: true, chunks: [] });
    });

    it('keeps the last event id across a discarded EOF event', () => {
        const decoder = new PluginSseDecoder();
        expect(decoder.push('id: 7\ndata: first\n\n')).toEqual({
            ok: true,
            chunks: [{ kind: 'data', id: '7', data: 'first' }],
        });
        expect(decoder.push('data: orphan\n')).toEqual({ ok: true, chunks: [] });
        expect(decoder.finish()).toEqual({ ok: true, chunks: [] });
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
