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
});
