import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSystemPromptsModal } from '../useSystemPromptsModal';

describe('useSystemPromptsModal', () => {
    afterEach(() => {
        useSystemPromptsModal().close();
    });

    it('opens home, edit, and new requests through one shared controller', () => {
        const first = useSystemPromptsModal();
        const second = useSystemPromptsModal();

        first.open({ mode: 'edit', promptId: 'prompt-1', paneId: 'pane-1' });
        expect(second.isOpen.value).toBe(true);
        expect(second.request.value).toMatchObject({
            mode: 'edit',
            promptId: 'prompt-1',
            paneId: 'pane-1',
        });

        second.open({ mode: 'new' });
        expect(first.request.value?.mode).toBe('new');
    });

    it('falls back to home when edit has no prompt id', () => {
        const modal = useSystemPromptsModal();
        modal.open({ mode: 'edit' });
        expect(modal.request.value?.mode).toBe('home');
    });

    it('notifies the request origin when a prompt is selected', () => {
        const onSelected = vi.fn();
        const modal = useSystemPromptsModal();
        modal.open({ mode: 'home', onSelected });

        modal.notifySelected('prompt-2');

        expect(onSelected).toHaveBeenCalledWith('prompt-2');
    });
});
