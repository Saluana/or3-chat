import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useServerRestart } from '../useServerRestart';

const mockConfirm = vi.fn();
const mockToastAdd = vi.fn();
const mockFetch = vi.fn();

vi.mock('../useConfirmDialog', () => ({
    useConfirmDialog: () => ({
        confirm: mockConfirm,
    }),
}));

vi.mock('#imports', () => ({
    useToast: () => ({
        add: mockToastAdd,
    }),
}));

globalThis.$fetch = mockFetch as unknown as typeof $fetch;

describe('useServerRestart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not restart when not owner', async () => {
        const isOwner = ref(false);
        const { restart } = useServerRestart(isOwner);

        await restart();

        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not restart when user cancels confirmation', async () => {
        const isOwner = ref(true);
        const { restart } = useServerRestart(isOwner);

        mockConfirm.mockResolvedValue(false);

        await restart();

        expect(mockConfirm).toHaveBeenCalledWith({
            title: 'Restart Server',
            message: 'Are you sure you want to restart the server now? This will cause temporary downtime.',
            danger: true,
            confirmText: 'Restart',
        });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('restarts server when confirmed and successful', async () => {
        const isOwner = ref(true);
        const { restart } = useServerRestart(isOwner);

        mockConfirm.mockResolvedValue(true);
        mockFetch.mockResolvedValue({ ok: true });

        await restart();

        expect(mockFetch).toHaveBeenCalledWith('/api/admin/system/restart', {
            method: 'POST',
            headers: { 'x-or3-admin-intent': 'admin' },
        });
        expect(mockToastAdd).toHaveBeenCalledWith({
            title: 'Restart initiated',
            description: 'The server is restarting...',
            color: 'success',
        });
    });

    it('shows error toast when restart fails', async () => {
        const isOwner = ref(true);
        const { restart } = useServerRestart(isOwner);

        mockConfirm.mockResolvedValue(true);
        mockFetch.mockRejectedValue(new Error('Network error'));

        await restart();

        expect(mockToastAdd).toHaveBeenCalledWith({
            title: 'Error',
            description: 'Network error',
            color: 'error',
        });
    });

    it('shows error toast with default message on unknown error', async () => {
        const isOwner = ref(true);
        const { restart } = useServerRestart(isOwner);

        mockConfirm.mockResolvedValue(true);
        mockFetch.mockRejectedValue({}); // Empty error object

        await restart();

        expect(mockToastAdd).toHaveBeenCalledWith({
            title: 'Error',
            description: 'Restart failed',
            color: 'error',
        });
    });

    it('does not restart when disabled by configuration', async () => {
        const isOwner = ref(true);
        const allowRestart = ref(false);
        const { restart } = useServerRestart(isOwner, allowRestart);

        await restart();

        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockToastAdd).toHaveBeenCalledWith({
            title: 'Restart Disabled',
            description: 'Server restart is disabled in configuration.',
            color: 'error',
        });
    });

    it('restarts when allowRestart is undefined (no restriction)', async () => {
        const isOwner = ref(true);
        const { restart } = useServerRestart(isOwner, undefined);

        mockConfirm.mockResolvedValue(true);
        mockFetch.mockResolvedValue({ ok: true });

        await restart();

        expect(mockFetch).toHaveBeenCalled();
    });

    it('exposes restartRequired ref', () => {
        const isOwner = ref(true);
        const { restartRequired } = useServerRestart(isOwner);

        expect(restartRequired.value).toBe(false);

        restartRequired.value = true;
        expect(restartRequired.value).toBe(true);
    });

    it('reacts to ownership changes', async () => {
        const isOwner = ref(false);
        const { restart } = useServerRestart(isOwner);

        // First try as non-owner
        await restart();
        expect(mockConfirm).not.toHaveBeenCalled();

        // Become owner
        isOwner.value = true;
        await nextTick();

        mockConfirm.mockResolvedValue(true);
        mockFetch.mockResolvedValue({ ok: true });

        await restart();
        expect(mockConfirm).toHaveBeenCalled();
    });
});
