import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { useConfirmDialog } from '../useConfirmDialog';

describe('useConfirmDialog', () => {
    beforeEach(() => {
        // Reset module state between tests
        vi.resetModules();
    });

    it('returns closed state initially', () => {
        const { isOpen, options } = useConfirmDialog();

        expect(isOpen.value).toBe(false);
        expect(options.value).toBeNull();
    });

    it('opens dialog with options when confirm is called', async () => {
        const { isOpen, options, confirm } = useConfirmDialog();

        const promise = confirm({
            title: 'Test Title',
            message: 'Test Message',
            danger: true,
            confirmText: 'Confirm',
        });

        await nextTick();

        expect(isOpen.value).toBe(true);
        expect(options.value).toEqual({
            title: 'Test Title',
            message: 'Test Message',
            danger: true,
            confirmText: 'Confirm',
        });

        // Cleanup
        const { onConfirm } = useConfirmDialog();
        onConfirm();
        await promise.catch(() => {});
    });

    it('resolves true when confirmed', async () => {
        const { confirm, onConfirm } = useConfirmDialog();

        const promise = confirm({
            title: 'Test',
            message: 'Test message',
        });

        onConfirm();

        const result = await promise;
        expect(result).toBe(true);
    });

    it('resolves false when cancelled', async () => {
        const { confirm, onCancel } = useConfirmDialog();

        const promise = confirm({
            title: 'Test',
            message: 'Test message',
        });

        onCancel();

        const result = await promise;
        expect(result).toBe(false);
    });

    it('closes dialog after confirm', async () => {
        const { isOpen, confirm, onConfirm } = useConfirmDialog();

        confirm({ title: 'Test', message: 'Test' });
        await nextTick();
        expect(isOpen.value).toBe(true);

        onConfirm();
        await nextTick();
        expect(isOpen.value).toBe(false);
    });

    it('closes dialog after cancel', async () => {
        const { isOpen, confirm, onCancel } = useConfirmDialog();

        confirm({ title: 'Test', message: 'Test' });
        await nextTick();
        expect(isOpen.value).toBe(true);

        onCancel();
        await nextTick();
        expect(isOpen.value).toBe(false);
    });

    it('handles multiple sequential confirmations', async () => {
        const { confirm, onConfirm, onCancel } = useConfirmDialog();

        // First confirmation - confirmed
        const promise1 = confirm({ title: 'First', message: 'First' });
        onConfirm();
        const result1 = await promise1;
        expect(result1).toBe(true);

        // Second confirmation - cancelled
        const promise2 = confirm({ title: 'Second', message: 'Second' });
        onCancel();
        const result2 = await promise2;
        expect(result2).toBe(false);

        // Third confirmation - confirmed
        const promise3 = confirm({ title: 'Third', message: 'Third' });
        onConfirm();
        const result3 = await promise3;
        expect(result3).toBe(true);
    });

    it('overwrites previous options on new confirm', async () => {
        const { options, confirm } = useConfirmDialog();

        confirm({ title: 'First', message: 'First message' });
        await nextTick();
        expect(options.value?.title).toBe('First');

        confirm({ title: 'Second', message: 'Second message' });
        await nextTick();
        expect(options.value?.title).toBe('Second');
        expect(options.value?.message).toBe('Second message');

        // Cleanup
        const { onConfirm } = useConfirmDialog();
        onConfirm();
    });
});
