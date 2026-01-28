import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ADMIN_HEADERS, useFileInput, installExtension, uninstallExtension } from '../useAdminExtensions';

// Mock useConfirmDialog
const confirmMock = vi.fn();
vi.mock('../useConfirmDialog', () => ({
    useConfirmDialog: () => ({
        confirm: confirmMock,
    }),
}));

describe('useAdminExtensions', () => {
    describe('ADMIN_HEADERS', () => {
        it('exports constant with correct value', () => {
            expect(ADMIN_HEADERS).toEqual({ 'x-or3-admin-intent': 'admin' });
        });

        it('has correct type structure', () => {
            // Type check - the const assertion ensures type safety
            const header: { 'x-or3-admin-intent': 'admin' } = ADMIN_HEADERS;
            expect(header['x-or3-admin-intent']).toBe('admin');
        });
    });

    describe('useFileInput', () => {
        it('returns fileInput ref and trigger function', () => {
            const { fileInput, triggerFileInput } = useFileInput();

            expect(fileInput.value).toBeNull();
            expect(typeof triggerFileInput).toBe('function');
        });

        it('triggers click on file input when called', () => {
            const { fileInput, triggerFileInput } = useFileInput();
            const mockClick = vi.fn();

            // Create a mock input element
            const mockInput = document.createElement('input');
            mockInput.click = mockClick;
            fileInput.value = mockInput;

            triggerFileInput();

            expect(mockClick).toHaveBeenCalled();
        });

        it('handles null input gracefully', () => {
            const { triggerFileInput } = useFileInput();

            // Should not throw
            expect(() => triggerFileInput()).not.toThrow();
        });
    });

    describe('installExtension', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            confirmMock.mockResolvedValue(true);
        });

        it('throws on non-already-installed errors', async () => {
            const error = new Error('Network error');
            const mockFetch = vi.fn().mockRejectedValue(error);
            globalThis.$fetch = mockFetch as unknown as typeof $fetch;

            const mockFile = new File([''], 'test.zip');

            await expect(
                installExtension({ kind: 'plugin', file: mockFile })
            ).rejects.toThrow('Network error');
        });
    });

    describe('uninstallExtension', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('returns early when user cancels confirmation', async () => {
            confirmMock.mockResolvedValue(false);
            const mockFetch = vi.fn().mockResolvedValue({ ok: true });
            globalThis.$fetch = mockFetch as unknown as typeof $fetch;

            await uninstallExtension('test-plugin', 'plugin');

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('calls API when user confirms', async () => {
            confirmMock.mockResolvedValue(true);
            const mockFetch = vi.fn().mockResolvedValue({ ok: true });
            globalThis.$fetch = mockFetch as unknown as typeof $fetch;

            await uninstallExtension('test-plugin', 'plugin');

            expect(mockFetch).toHaveBeenCalledWith('/api/admin/extensions/uninstall', {
                method: 'POST',
                body: { id: 'test-plugin', kind: 'plugin' },
                headers: ADMIN_HEADERS,
            });
        });

        it('calls onSuccess callback after successful uninstall', async () => {
            confirmMock.mockResolvedValue(true);
            const mockFetch = vi.fn().mockResolvedValue({ ok: true });
            globalThis.$fetch = mockFetch as unknown as typeof $fetch;
            const onSuccess = vi.fn().mockResolvedValue(undefined);

            await uninstallExtension('test-plugin', 'plugin', onSuccess);

            expect(onSuccess).toHaveBeenCalled();
        });
    });
});
