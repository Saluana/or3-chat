import { describe, expect, it, vi } from 'vitest';
import {
    getFailedAttachmentCount,
    guardPendingAttachmentSend,
} from '../pendingAttachmentGuard';

describe('guardPendingAttachmentSend', () => {
    it('blocks a send when an attachment failed instead of omitting it', () => {
        const add = vi.fn();

        expect(
            guardPendingAttachmentSend(
                [{ status: 'error' }, { status: 'ready' }],
                { add }
            )
        ).toBe(false);
        expect(getFailedAttachmentCount([{ status: 'error' }])).toBe(1);
        expect(add).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Attachment needs attention' })
        );
    });
});
