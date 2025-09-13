import { describe, it, expect, vi, beforeEach } from 'vitest';
import '~/../tests/setup';
import { validateFile, persistAttachment } from '../file-upload-utils';

vi.mock('#imports', () => ({
    useToast: () => ({ add: vi.fn() }),
}));

// Mock file persistence to control failures
vi.mock('~/db/files', () => ({
    createOrRefFile: vi.fn(async () => ({
        hash: 'h',
        name: 'x',
        mime_type: 'image/png',
        kind: 'image',
        size_bytes: 10,
    })),
}));

import { createOrRefFile } from '~/db/files';
import { useHooks } from '~/composables/useHooks';
vi.mock('~/composables/useHooks', () => ({
    useHooks: () => ({
        applyFilters: (_: any, v: any) => v,
        doAction: vi.fn(),
    }),
}));
vi.mock('~/composables/useModelStore', () => {
    const { ref } = require('vue');
    return {
        useModelStore: () => ({
            selectedModelId: ref('model-x'),
            favoriteModels: ref([]),
            catalog: ref([]),
            setSelectedModelId: () => {},
        }),
    };
});
vi.mock('~/composables/useUserApiKey', () => ({
    useUserApiKey: () => ({ apiKey: { value: 'k' } }),
}));
vi.mock('~/composables/useOpenrouter', () => ({ useOpenRouter: () => ({}) }));
vi.mock('~/composables/useOpenrouter', () => ({ useOpenrouter: () => ({}) }));
vi.mock('~/composables/useOpenRouterAuth', () => ({
    useOpenRouterAuth: () => ({ startLogin: () => {} }),
}));

function makeFile(name: string, type: string, size = 1000): File {
    const blob = new Blob(['a'.repeat(size)], { type });
    return new File([blob], name, { type });
}

describe('file validation & persistence', () => {
    beforeEach(() => {
        (createOrRefFile as any).mockClear();
    });

    it('rejects unsupported mime', async () => {
        const file = makeFile('doc.txt', 'text/plain');
        const v = validateFile(file);
        expect(v.ok).toBe(false);
        expect((v as any).message).toMatch(/Unsupported/);
        expect(createOrRefFile).not.toHaveBeenCalled();
    });

    it('rejects oversize file', async () => {
        const big = makeFile('big.png', 'image/png', 25 * 1024 * 1024); // 25MB
        const v = validateFile(big);
        expect(v.ok).toBe(false);
        expect((v as any).message).toMatch(/too large/i);
        expect(createOrRefFile).not.toHaveBeenCalled();
    });

    it('reports persistence failure with retry', async () => {
        (createOrRefFile as any).mockImplementationOnce(async () => {
            throw new Error('disk boom');
        });
        const img = makeFile('x.png', 'image/png');
        const v = validateFile(img);
        expect(v.ok).toBe(true);
        const att: any = { file: img, name: 'x.png', status: 'pending' };
        await persistAttachment(att);
        expect(att.status).toBe('error');
        expect(att.error).toContain('disk boom');
    });
});
