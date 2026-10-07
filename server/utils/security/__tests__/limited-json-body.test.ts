import { beforeEach, describe, expect, it, vi } from 'vitest';

const getHeaderMock = vi.fn();
const readBodyMock = vi.fn();
vi.mock('h3', () => ({
    getHeader: (...args: unknown[]) => getHeaderMock(...args),
    readBody: (...args: unknown[]) => readBodyMock(...args),
    createError: (options: {
        statusCode: number;
        statusMessage: string;
    }) =>
        Object.assign(new Error(options.statusMessage), {
            statusCode: options.statusCode,
        }),
}));

import { readLimitedJsonBody } from '../limited-json-body';

describe('bounded anonymous JSON body reader', () => {
    beforeEach(() => {
        getHeaderMock.mockReset().mockReturnValue(undefined);
        readBodyMock.mockReset();
    });

    it('rejects a declared oversized body before reading it', async () => {
        getHeaderMock.mockReturnValue('8193');
        await expect(
            readLimitedJsonBody({} as never, 8192)
        ).rejects.toMatchObject({ statusCode: 413 });
        expect(readBodyMock).not.toHaveBeenCalled();
    });

    it('stops a chunked request as soon as the streaming cap is crossed', async () => {
        const request = {
            async *[Symbol.asyncIterator]() {
                yield Buffer.alloc(5_000, 'a');
                yield Buffer.alloc(4_000, 'b');
                throw new Error('reader continued after the cap');
            },
        };
        await expect(
            readLimitedJsonBody(
                { node: { req: request } } as never,
                8192
            )
        ).rejects.toMatchObject({ statusCode: 413 });
        expect(readBodyMock).not.toHaveBeenCalled();
    });

    it('parses a JSON body that stays inside the streaming cap', async () => {
        const request = {
            async *[Symbol.asyncIterator]() {
                yield Buffer.from('{"deviceCode":"safe"}');
            },
        };
        await expect(
            readLimitedJsonBody(
                { node: { req: request } } as never,
                8192
            )
        ).resolves.toEqual({ deviceCode: 'safe' });
    });
    // Events built by h3's web adapter carry the body as a web stream; their
    // Node request is a shim whose iterator throws. Failure case: the reader
    // iterates the shim and every such request fails.
    it('reads the body stream of a web-adapter event instead of its Node shim', async () => {
        const shim = {
            async *[Symbol.asyncIterator]() {
                throw new Error('the Node request shim must not be iterated');
            },
        };
        const web = new Request('https://chat.test/', {
            method: 'POST',
            body: JSON.stringify({ deviceCode: 'safe' }),
        });
        await expect(
            readLimitedJsonBody(
                { node: { req: shim }, web: { request: web } } as never,
                8192
            )
        ).resolves.toEqual({ deviceCode: 'safe' });
    });

    it('stops a web-adapter body as soon as the cap is crossed', async () => {
        const web = new Request('https://chat.test/', {
            method: 'POST',
            body: Buffer.alloc(9_000, 'a'),
        });
        await expect(
            readLimitedJsonBody(
                { node: { req: {} }, web: { request: web } } as never,
                8192
            )
        ).rejects.toMatchObject({ statusCode: 413 });
        expect(readBodyMock).not.toHaveBeenCalled();
    });
});
