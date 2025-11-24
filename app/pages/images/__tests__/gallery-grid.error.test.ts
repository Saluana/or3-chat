import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { makeMeta } from './test-utils';
import type { FileMeta } from '~/db/schema';

const { getMocks } = vi.hoisted(() => {
    const toastAdd = vi.fn();
    const getFileBlob = vi.fn();
    const reportError = vi.fn();
    return {
        getMocks: () => ({ toastAdd, getFileBlob, reportError }),
    };
});

function createFilesMock() {
    const mocks = getMocks();
    return { getFileBlob: mocks.getFileBlob };
}

function createErrorsMock() {
    const mocks = getMocks();
    return { reportError: mocks.reportError };
}

vi.mock('#imports', () => ({
    useToast: () => ({ add: getMocks().toastAdd }),
    useIcon: (name: string) => name,
}));

vi.mock('../../db/files', createFilesMock);
vi.mock('~/db/files', createFilesMock);
vi.mock(
    new URL('../../../db/files.ts', import.meta.url).pathname,
    createFilesMock
);

vi.mock('../../utils/errors', createErrorsMock);
vi.mock('~/utils/errors', createErrorsMock);
vi.mock(
    new URL('../../../utils/errors.ts', import.meta.url).pathname,
    createErrorsMock
);

const mocks = getMocks();

describe('GalleryGrid preview errors', () => {
    beforeEach(() => {
        mocks.toastAdd.mockReset();
        mocks.getFileBlob.mockReset();
        mocks.reportError.mockReset();
        vi.stubGlobal(
            'IntersectionObserver',
            vi.fn(() => ({
                observe: vi.fn(),
                disconnect: vi.fn(),
            }))
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reports through reportError when blob loading fails', async () => {
        mocks.getFileBlob.mockRejectedValueOnce(new Error('fail'));
        const meta = makeMeta('oops');
        const GalleryGrid = (await import('../GalleryGrid.vue')).default;
        const wrapper = mount(GalleryGrid, {
            props: {
                items: [meta],
                selectionMode: false,
                selectedHashes: new Set<string>(),
            },
            global: {
                stubs: {
                    UButton: true,
                    UIcon: true,
                    UButtonGroup: true,
                },
            },
        });

        await (
            wrapper.vm as unknown as {
                ensureUrl(meta: FileMeta): Promise<void>;
            }
        ).ensureUrl(meta);

        expect(mocks.reportError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                code: 'ERR_DB_READ_FAILED',
                tags: expect.objectContaining({
                    action: 'preview',
                    hash: 'oops',
                }),
            })
        );
    });
});
