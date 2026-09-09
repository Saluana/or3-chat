import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
    current: null as any,
    message: null as any,
    create: vi.fn(),
    change: vi.fn(),
    put: vi.fn(),
}));
vi.mock('~/db/client', () => ({ getDb: () => state.current }));
vi.mock('~/db/files', () => ({
    createOrRefFile: state.create,
    changeRefCount: state.change,
}));
vi.mock('~/db/util', () => ({
    getWriteTxTableNames: (_: unknown, tables: string[]) => tables,
    nowSec: () => 42,
    nextClock: () => 43,
}));
import { withWorkflowGeneratedImages } from '../workflowGeneratedImages';
const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function setup(url = png) {
    const generated = {
        content: null,
        assistantMessage: { role: 'assistant', content: '' },
        images: [{ url }],
        requestedModels: ['image-model'],
    };
    const gateway = {
        generate: vi.fn().mockResolvedValue(generated),
        getModelCapabilities: vi.fn(),
    };
    return {
        gateway,
        wrapped: withWorkflowGeneratedImages(gateway as any, 'message'),
    };
}
beforeEach(() => {
    vi.clearAllMocks();
    state.message = { id: 'message', file_hashes: null, clock: 1 };
    state.put.mockImplementation(async (message) => {
        state.message = message;
    });
    state.current = {
        transaction: async (
            _: unknown,
            __unknown: unknown,
            fn: () => unknown,
        ) => fn(),
        messages: { get: async () => state.message, put: state.put },
    };
    state.create.mockResolvedValue({ hash: 'hash' });
    state.change.mockResolvedValue(undefined);
});
describe('workflow generated image ownership', () => {
    it('stores raster bytes once and attaches a canonical message reference without retaining base64', async () => {
        const { wrapped } = setup();
        const result = await wrapped.generate({
            models: ['image-model'],
            messages: [],
        } as any);
        expect(state.create).toHaveBeenCalledOnce();
        expect(state.message.file_hashes).toBe(JSON.stringify(['hash']));
        expect(result.images).toBeUndefined();
        expect(result.content).toContain('file-hash:hash');
        expect(JSON.stringify(result)).not.toContain('data:image');
        await wrapped.generate({
            models: ['image-model'],
            messages: [],
        } as any);
        expect(state.message.file_hashes).toBe(JSON.stringify(['hash']));
        expect(state.change).toHaveBeenCalledWith('hash', -1, state.current);
    });
    it.each([
        'https://example.com/untrusted.png',
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        'data:image/png;base64,PGh0bWw+',
    ])('rejects unsupported image output before storage: %s', async (url) => {
        await expect(
            setup(url).wrapped.generate({
                models: ['image-model'],
                messages: [],
            } as any),
        ).rejects.toThrow('supported raster');
        expect(state.create).not.toHaveBeenCalled();
    });
    it('ignores a generated result after changing workspace', async () => {
        const { gateway, wrapped } = setup();
        gateway.generate.mockImplementation(async () => {
            state.current = {};
            return { images: [{ url: png }] };
        });
        await expect(
            wrapped.generate({ models: ['image-model'], messages: [] } as any),
        ).rejects.toThrow('session');
        expect(state.create).not.toHaveBeenCalled();
    });
    it('releases the staged reference when the message disappears', async () => {
        const { wrapped } = setup();
        state.message = null;
        await expect(
            wrapped.generate({ models: ['image-model'], messages: [] } as any),
        ).rejects.toThrow('no longer available');
        expect(state.change).toHaveBeenCalledWith('hash', -1, state.current);
    });
});
