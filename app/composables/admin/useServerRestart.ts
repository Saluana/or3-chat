import { ref, type Ref, type ComputedRef } from 'vue';
import { useToast } from '#imports';
import { ADMIN_HEADERS } from './useAdminExtensions';
import { useConfirmDialog } from './useConfirmDialog';
import { errorContains, parseErrorMessage } from '~/utils/admin/parse-error';

export type ServerRestart = {
    restart: () => Promise<void>;
    restartRequired: Ref<boolean>;
};

/**
 * Manage server restart operations with confirmation and toast notifications.
 * Note: useToast is auto-imported by Nuxt UI.
 */
export function useServerRestart(
    isOwner: Ref<boolean> | ComputedRef<boolean>,
    allowRestart?: Ref<boolean | undefined> | ComputedRef<boolean | undefined>
): ServerRestart {
    const { confirm } = useConfirmDialog();
    const toast = useToast();
    const restartRequired = ref(false);

    async function restart() {
        if (!isOwner.value) return;
        if (allowRestart?.value === false) {
            toast.add({
                title: 'Restart Disabled',
                description: 'Server restart is disabled in configuration.',
                color: 'error',
            });
            return;
        }

        const confirmed = await confirm({
            title: 'Restart Server',
            message: 'Are you sure you want to restart the server now? This will cause temporary downtime.',
            danger: true,
            confirmText: 'Restart',
        });
        if (!confirmed) return;

        try {
            await $fetch('/api/admin/system/restart', {
                method: 'POST',
                headers: ADMIN_HEADERS,
            });
            toast.add({
                title: 'Restart initiated',
                description: 'The server is restarting...',
                color: 'success',
            });
        } catch (error: unknown) {
            if (errorContains(error, 'development mode')) {
                toast.add({
                    title: 'Restart unavailable in dev',
                    description:
                        'Please restart the dev server manually (Ctrl+C, then `bun run dev`).',
                    color: 'info',
                });
                return;
            }
            const message = parseErrorMessage(error, 'Restart failed');
            toast.add({ title: 'Error', description: message, color: 'error' });
        }
    }

    return {
        restart,
        restartRequired,
    };
}
