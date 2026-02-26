/**
 * Shared types and utilities for admin extension management.
 * Consolidates common patterns from plugins.vue and themes.vue.
 */

import { ref } from 'vue';
import { useConfirmDialog } from './useConfirmDialog';
import { parseErrorMessage } from '~/utils/admin/parse-error';

/**
 * Standard admin intent header for admin API calls.
 */
export const ADMIN_HEADERS = { 'x-or3-admin-intent': 'admin' } as const;

export type ExtensionKind = 'plugin' | 'theme' | 'admin_plugin';

export type ExtensionItem = {
    id: string;
    name: string;
    version: string;
    kind: ExtensionKind;
    description?: string;
};

export type ExtensionInstallOptions = {
    kind: ExtensionKind;
    file: File;
    force?: boolean;
    onSuccess?: () => Promise<void>;
};

/**
 * Install an extension (plugin or theme) from a .zip file.
 * Handles duplicate detection and retry with force flag.
 */
export async function installExtension(options: ExtensionInstallOptions): Promise<void> {
    const { file, force = false, onSuccess } = options;
    const formData = new FormData();
    formData.append('file', file);
    if (force) {
        formData.append('force', 'true');
    }

    try {
        await $fetch('/api/admin/extensions/install', {
            method: 'POST',
            body: formData,
            headers: ADMIN_HEADERS,
        });
        if (onSuccess) await onSuccess();
    } catch (error: unknown) {
        const message = parseErrorMessage(error, '');
        
        if (message.toLowerCase().includes('already installed')) {
            const { confirm } = useConfirmDialog();
            const confirmed = await confirm({
                title: `${options.kind === 'plugin' ? 'Plugin' : 'Theme'} Already Installed`,
                message: `This ${options.kind === 'plugin' ? 'plugin' : 'theme'} is already installed. Do you want to replace it with the new version?`,
                danger: true,
                confirmText: 'Replace',
            });
            if (!confirmed) return;
            // Retry with force flag
            await installExtension({ ...options, force: true });
        } else {
            throw error;
        }
    }
}

export type ExtensionUrlInstallOptions = {
    kind: ExtensionKind;
    url: string;
    force?: boolean;
    onSuccess?: () => Promise<void>;
};

/**
 * Install an extension (plugin or theme) from a remote URL.
 * The server fetches the ZIP and runs the same install pipeline.
 */
export async function installExtensionFromUrl(options: ExtensionUrlInstallOptions): Promise<void> {
    const { url, force = false, onSuccess } = options;

    try {
        await $fetch('/api/admin/extensions/install', {
            method: 'POST',
            body: { url, force },
            headers: ADMIN_HEADERS,
        });
        if (onSuccess) await onSuccess();
    } catch (error: unknown) {
        const message = parseErrorMessage(error, '');

        if (message.toLowerCase().includes('already installed')) {
            const { confirm } = useConfirmDialog();
            const confirmed = await confirm({
                title: `${options.kind === 'plugin' ? 'Plugin' : 'Theme'} Already Installed`,
                message: `This ${options.kind === 'plugin' ? 'plugin' : 'theme'} is already installed. Do you want to replace it with the new version?`,
                danger: true,
                confirmText: 'Replace',
            });
            if (!confirmed) return;
            await installExtensionFromUrl({ ...options, force: true });
        } else {
            throw error;
        }
    }
}

/**
 * Uninstall an extension by ID and kind.
 */
export async function uninstallExtension(
    id: string,
    kind: ExtensionKind,
    onSuccess?: () => Promise<void>
): Promise<void> {
    const { confirm } = useConfirmDialog();
    const label = kind === 'plugin' ? 'Plugin' : 'Theme';
    const confirmed = await confirm({
        title: `Uninstall ${label}`,
        message: `Are you sure you want to uninstall "${id}"?`,
        danger: true,
        confirmText: 'Uninstall',
    });
    if (!confirmed) return;

    await $fetch('/api/admin/extensions/uninstall', {
        method: 'POST',
        body: { id, kind },
        headers: ADMIN_HEADERS,
    });

    if (onSuccess) await onSuccess();
}

/**
 * Composable for file input handling.
 * Returns ref to input element and trigger function.
 */
export function useFileInput() {
    const fileInput = ref<HTMLInputElement | null>(null);

    const triggerFileInput = () => {
        fileInput.value?.click();
    };

    return {
        fileInput,
        triggerFileInput,
    };
}
