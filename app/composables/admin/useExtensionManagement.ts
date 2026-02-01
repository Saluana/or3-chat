import { type Ref, type ComputedRef } from 'vue';
import { installExtension, uninstallExtension, useFileInput, type ExtensionKind } from './useAdminExtensions';

export type ExtensionManagement = {
    fileInput: Ref<HTMLInputElement | null>;
    triggerFileInput: () => void;
    install: (kind: ExtensionKind, onSuccess?: () => Promise<void>) => Promise<void>;
    uninstall: (id: string, kind: ExtensionKind, onSuccess?: () => Promise<void>) => Promise<void>;
};

/**
 * Manage extension installation/uninstallation.
 * Provides file input handling and install/uninstall operations.
 */
export function useExtensionManagement(
    isOwner: Ref<boolean> | ComputedRef<boolean>
): ExtensionManagement {
    const { fileInput, triggerFileInput } = useFileInput();

    async function install(kind: ExtensionKind, onSuccess?: () => Promise<void>) {
        if (!isOwner.value) return;
        const file = fileInput.value?.files?.[0];
        if (!file) return;
        await installExtension({ kind, file, onSuccess });
    }

    async function uninstall(
        id: string,
        kind: ExtensionKind,
        onSuccess?: () => Promise<void>
    ) {
        if (!isOwner.value) return;
        await uninstallExtension(id, kind, onSuccess);
    }

    return {
        fileInput,
        triggerFileInput,
        install,
        uninstall,
    };
}
