import { type Ref, type ComputedRef } from 'vue';
import {
    installExtension,
    installExtensionFromUrl,
    uninstallExtension,
    useFileInput,
    type ExtensionInstallResult,
    type ExtensionKind,
} from './useAdminExtensions';

export type ExtensionManagement = {
    fileInput: Ref<HTMLInputElement | null>;
    triggerFileInput: () => void;
    install: (
        kind: ExtensionKind,
        onSuccess?: () => Promise<void>,
        workspaceId?: string
    ) => Promise<ExtensionInstallResult | false>;
    installFromUrl: (
        kind: ExtensionKind,
        url: string,
        onSuccess?: () => Promise<void>,
        workspaceId?: string
    ) => Promise<ExtensionInstallResult | false>;
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

    async function install(
        kind: ExtensionKind,
        onSuccess?: () => Promise<void>,
        workspaceId?: string
    ) {
        if (!isOwner.value) return false;
        const file = fileInput.value?.files?.[0];
        if (!file) return false;
        return await installExtension({
            kind,
            file,
            onSuccess,
            ...(workspaceId ? { workspaceId } : {}),
        });
    }

    async function installFromUrl(
        kind: ExtensionKind,
        url: string,
        onSuccess?: () => Promise<void>,
        workspaceId?: string
    ) {
        if (!isOwner.value) return false;
        if (!url.trim()) return false;
        return await installExtensionFromUrl({
            kind,
            url: url.trim(),
            onSuccess,
            ...(workspaceId ? { workspaceId } : {}),
        });
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
        installFromUrl,
        uninstall,
    };
}
