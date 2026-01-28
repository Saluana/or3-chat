import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useExtensionManagement } from '../useExtensionManagement';

// Mock the dependencies
const mockInstallExtension = vi.fn();
const mockUninstallExtension = vi.fn();
const mockUseFileInput = vi.fn();

vi.mock('../useAdminExtensions', () => ({
    installExtension: (...args: unknown[]) => mockInstallExtension(...args),
    uninstallExtension: (...args: unknown[]) => mockUninstallExtension(...args),
    useFileInput: () => mockUseFileInput(),
    ADMIN_HEADERS: { 'x-or3-admin-intent': 'admin' },
}));

describe('useExtensionManagement', () => {
    const mockFileInput = { value: null as HTMLInputElement | null };
    const mockTriggerFileInput = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseFileInput.mockReturnValue({
            fileInput: mockFileInput,
            triggerFileInput: mockTriggerFileInput,
        });
    });

    it('returns file input refs and functions', () => {
        const isOwner = ref(true);
        const { fileInput, triggerFileInput, install, uninstall } = useExtensionManagement(isOwner);

        expect(fileInput).toBe(mockFileInput);
        expect(triggerFileInput).toBe(mockTriggerFileInput);
        expect(typeof install).toBe('function');
        expect(typeof uninstall).toBe('function');
    });

    it('does not install when not owner', async () => {
        const isOwner = ref(false);
        const { install } = useExtensionManagement(isOwner);

        await install('plugin');

        expect(mockInstallExtension).not.toHaveBeenCalled();
    });

    it('does not install when no file selected', async () => {
        const isOwner = ref(true);
        const { install } = useExtensionManagement(isOwner);

        mockFileInput.value = null;

        await install('plugin');

        expect(mockInstallExtension).not.toHaveBeenCalled();
    });

    it('installs extension when owner and file selected', async () => {
        const isOwner = ref(true);
        const { install } = useExtensionManagement(isOwner);

        const mockFile = new File(['test'], 'test.zip');
        mockFileInput.value = { files: [mockFile] } as unknown as HTMLInputElement;

        mockInstallExtension.mockResolvedValue(undefined);

        const onSuccess = vi.fn();
        await install('plugin', onSuccess);

        expect(mockInstallExtension).toHaveBeenCalledWith({
            kind: 'plugin',
            file: mockFile,
            onSuccess,
        });
    });

    it('does not uninstall when not owner', async () => {
        const isOwner = ref(false);
        const { uninstall } = useExtensionManagement(isOwner);

        await uninstall('test-plugin', 'plugin');

        expect(mockUninstallExtension).not.toHaveBeenCalled();
    });

    it('uninstalls extension when owner', async () => {
        const isOwner = ref(true);
        const { uninstall } = useExtensionManagement(isOwner);

        mockUninstallExtension.mockResolvedValue(undefined);

        const onSuccess = vi.fn();
        await uninstall('test-plugin', 'plugin', onSuccess);

        expect(mockUninstallExtension).toHaveBeenCalledWith('test-plugin', 'plugin', onSuccess);
    });

    it('handles theme kind correctly', async () => {
        const isOwner = ref(true);
        const { install, uninstall } = useExtensionManagement(isOwner);

        const mockFile = new File(['test'], 'theme.zip');
        mockFileInput.value = { files: [mockFile] } as unknown as HTMLInputElement;

        mockInstallExtension.mockResolvedValue(undefined);
        mockUninstallExtension.mockResolvedValue(undefined);

        await install('theme');
        await uninstall('test-theme', 'theme');

        expect(mockInstallExtension).toHaveBeenCalledWith(expect.objectContaining({ kind: 'theme' }));
        expect(mockUninstallExtension).toHaveBeenCalledWith('test-theme', 'theme', undefined);
    });

    it('reacts to ownership changes', async () => {
        const isOwner = ref(false);
        const { install } = useExtensionManagement(isOwner);

        // First try as non-owner
        await install('plugin');
        expect(mockInstallExtension).not.toHaveBeenCalled();

        // Become owner
        isOwner.value = true;
        await nextTick();

        const mockFile = new File(['test'], 'test.zip');
        mockFileInput.value = { files: [mockFile] } as unknown as HTMLInputElement;

        await install('plugin');
        expect(mockInstallExtension).toHaveBeenCalled();
    });
});
