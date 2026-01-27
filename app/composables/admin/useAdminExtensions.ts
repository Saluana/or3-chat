/**
 * Shared types and utilities for admin extension management.
 * Consolidates common patterns from plugins.vue and themes.vue.
 */

import { ref } from 'vue';

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
        const message = extractErrorMessage(error);
        
        if (message.toLowerCase().includes('already installed')) {
            if (!confirm(`${options.kind === 'plugin' ? 'Plugin' : 'Theme'} already installed. Replace it?`)) {
                return;
            }
            // Retry with force flag
            await installExtension({ ...options, force: true });
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
    const label = kind === 'plugin' ? 'Plugin' : 'Theme';
    if (!confirm(`Uninstall ${label} "${id}"?`)) return;

    await $fetch('/api/admin/extensions/uninstall', {
        method: 'POST',
        body: { id, kind },
        headers: ADMIN_HEADERS,
    });

    if (onSuccess) await onSuccess();
}

/**
 * Extract error message from various error shapes.
 */
function extractErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
        const e = error as { data?: { statusMessage?: string }; message?: string };
        return e.data?.statusMessage ?? e.message ?? '';
    }
    return '';
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
