import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
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

vi.mock('#imports', () => ({ useToast: () => ({ add: getMocks().toastAdd }) }));

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

const makeMeta = (hash: string): FileMeta => ({
    hash,
    name: `Image ${hash}`,
    mime_type: 'image/png',
    kind: 'image',
    size_bytes: 128,
    width: 16,
    height: 16,
    page_count: undefined,
    ref_count: 0,
    created_at: 1,
    updated_at: 2,
    deleted: false,
    clock: 0,
});

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
