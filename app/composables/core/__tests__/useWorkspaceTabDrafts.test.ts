import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceTabDrafts } from '../useWorkspaceTabDrafts';

describe('useWorkspaceTabDrafts', () => {
    afterEach(() => {
        useWorkspaceTabDrafts().clear();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('keeps a closed draft for Undo, then releases its blob URL on expiry', () => {
        vi.useFakeTimers();
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', { revokeObjectURL });
        const drafts = useWorkspaceTabDrafts();
        drafts.write('tab-a', {
            version: 1,
            text: 'draft',
            attachments: [
                {
                    url: 'blob:preview-a',
                    name: 'preview.png',
                    status: 'pending',
                    mime: 'image/png',
                    kind: 'image',
                } as never,
            ],
            largeTextBlocks: [],
            updatedAt: 1,
        });

        drafts.discardAfter('tab-a', 1000);
        expect(drafts.read('tab-a')?.text).toBe('draft');
        vi.advanceTimersByTime(1000);
        expect(revokeObjectURL).not.toHaveBeenCalled();

        drafts.discardAfter('tab-a', 1000);
        vi.advanceTimersByTime(1000);
        expect(drafts.read('tab-a')).toBeUndefined();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-a');
    });
});
