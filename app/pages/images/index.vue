<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import type { FileMeta } from '../../db/schema';
import { listAllImageMetas, updateFileName } from '../../db/files-select';
import {
    createOrRefFile,
    getFileBlob,
    getFileMeta,
    softDeleteMany,
    fileDeleteError,
    restoreMany,
    hardDeleteMany,
} from '../../db/files';
import { listDocuments } from '../../db/documents';
import { parseDocumentFileHashes } from '~/utils/documents/document-content';
import {
    consumePendingPaletteImageSelection,
    subscribePaletteImageSelection,
} from '~/core/search/command-palette/image-selection';
import GalleryGrid from './GalleryGrid.vue';
import ImageViewer from './ImageViewer.vue';
import { reportError } from '../../utils/errors';
import { useToast, useIcon } from '#imports';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { copyImageBlobToClipboard } from './copy-image-to-clipboard';
import { useImageSearch } from '~/core/search/useImageSearch';
import {
    filterImageLibrary,
    imageLibraryCounts,
    sortImageLibrary,
    type ImageLibrarySort,
    type ImageLibraryView,
} from './image-library';

const PAGE_SIZE = 50;
const items = ref<FileMeta[]>([]);
const loading = ref(false);
const visibleLimit = ref(PAGE_SIZE);
const activeView = ref<ImageLibraryView>('all');
const sortMode = ref<ImageLibrarySort>('newest');
const usedInDocumentHashes = ref<Set<string>>(new Set());
const showViewer = ref(false);
const selected = ref<FileMeta | null>(null);
const selectionMode = ref(false);
const selectedHashes = ref<Set<string>>(new Set());
const trashMode = computed(() => activeView.value === 'trash');
type MutationState = 'idle' | 'soft-delete' | 'hard-delete' | 'restore';
// Keep this union in sync with the computed helpers below so template logic stays DRY.
const mutationState = ref<MutationState>('idle');
const isMutating = computed(() => mutationState.value !== 'idle');
const isSoftDeleting = computed(() => mutationState.value === 'soft-delete');
const isHardDeleting = computed(() => mutationState.value === 'hard-delete');
const isRestoring = computed(() => mutationState.value === 'restore');
const toast = useToast();
const uploadInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

const selectedCount = computed(() => selectedHashes.value.size);
const hasSelection = computed(() => selectedCount.value > 0);
const hasItems = computed(() => visibleItems.value.length > 0);
const canSelectAll = computed(
    () =>
        hasItems.value && selectedHashes.value.size < visibleItems.value.length
);

const searchableItems = computed(() => items.value);
const imageSearch = useImageSearch(searchableItems);
const searchQuery = imageSearch.query;
const searchedHashes = computed(
    () => new Set(imageSearch.results.value.map((item) => item.hash))
);
const activeItems = computed(() =>
    items.value.filter((item) => item.deleted === trashMode.value)
);
const filteredItems = computed(() => {
    const searched = searchQuery.value.trim()
        ? activeItems.value.filter((item) =>
              searchedHashes.value.has(item.hash)
          )
        : activeItems.value;
    return sortImageLibrary(
        filterImageLibrary(
            searched,
            activeView.value,
            usedInDocumentHashes.value
        ),
        sortMode.value
    );
});
const visibleItems = computed(() =>
    filteredItems.value.slice(0, visibleLimit.value)
);
const done = computed(() => visibleLimit.value >= filteredItems.value.length);
const counts = computed(() =>
    imageLibraryCounts(
        items.value.filter((item) => !item.deleted),
        items.value.filter((item) => item.deleted),
        usedInDocumentHashes.value
    )
);

const libraryViews: Array<{
    id: ImageLibraryView;
    label: string;
    icon: string;
}> = [
    { id: 'all', label: 'All images', icon: useIcon('image.multiple').value },
    {
        id: 'uploads',
        label: 'Uploads',
        icon: useIcon('dashboard.backup').value,
    },
    {
        id: 'generated',
        label: 'Generated',
        icon: useIcon('dashboard.plugins').value,
    },
    {
        id: 'used-in-docs',
        label: 'Used in docs',
        icon: useIcon('ui.notes').value,
    },
    { id: 'trash', label: 'Trash', icon: useIcon('ui.trash').value },
];

const sortOptions = [
    { label: 'Newest first', value: 'newest' },
    { label: 'Oldest first', value: 'oldest' },
    { label: 'Name A–Z', value: 'name-asc' },
    { label: 'Name Z–A', value: 'name-desc' },
    { label: 'Largest first', value: 'largest' },
    { label: 'Smallest first', value: 'smallest' },
];

type DeleteOutcome = {
    attempted: string[];
    removed: string[];
    remaining: string[];
    aborted: boolean;
};

type RestoreOutcome = {
    attempted: string[];
    restored: string[];
    remaining: string[];
    aborted: boolean;
};

async function refreshLibrary() {
    if (loading.value) return;
    loading.value = true;
    try {
        const [library, trash, documents] = await Promise.all([
            listAllImageMetas(false),
            listAllImageMetas(true),
            listDocuments(Number.MAX_SAFE_INTEGER),
        ]);
        items.value = [...library, ...trash];
        usedInDocumentHashes.value = new Set(
            documents.flatMap((document) =>
                parseDocumentFileHashes(document.file_hashes)
            )
        );
        await imageSearch.rebuild();
        await imageSearch.search();
    } finally {
        loading.value = false;
    }
}

function loadMore() {
    visibleLimit.value += PAGE_SIZE;
}

/**
 * Open the viewer for a hash requested by the command palette. The image may
 * live outside the first page, so the meta is read directly.
 */
async function openPaletteSelection(hash: string) {
    if (!hash) return;
    const meta =
        items.value.find((item) => item.hash === hash) ??
        (await getFileMeta(hash));
    if (!meta || meta.deleted) return;
    selected.value = meta;
    showViewer.value = true;
}

let stopPaletteSelection: (() => void) | null = null;

onMounted(() => {
    void refreshLibrary();
    stopPaletteSelection = subscribePaletteImageSelection((hash) => {
        consumePendingPaletteImageSelection();
        if (hash) void openPaletteSelection(hash);
    });
    // The request is queued before this page mounts on a cold open.
    const pending = consumePendingPaletteImageSelection();
    if (pending) void openPaletteSelection(pending);
});

onUnmounted(() => {
    stopPaletteSelection?.();
});

async function handleDownload(meta: FileMeta) {
    let url: string | undefined;
    try {
        const blob = await getFileBlob(meta.hash);
        if (!blob) throw new Error('blob missing');
        url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = meta.name || 'image';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (error) {
        reportError(error, {
            code: 'ERR_DB_READ_FAILED',
            message: `Couldn't download "${meta.name || 'image'}".`,
            tags: { domain: 'images', action: 'download', hash: meta.hash },
        });
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
}

async function handleCopy(meta: FileMeta) {
    let blob: Blob;
    try {
        const resolved = await getFileBlob(meta.hash);
        if (!resolved) throw new Error('blob missing');
        blob = resolved;
    } catch (error) {
        reportError(error, {
            code: 'ERR_DB_READ_FAILED',
            message: `Couldn't copy "${meta.name || 'image'}".`,
            tags: { domain: 'images', action: 'copy', hash: meta.hash },
        });
        return;
    }

    const mime = meta.mime_type || 'image/png';
    const showCopiedToast = () =>
        toast.add({
            title: 'Image copied',
            description: `${meta.name || 'Image'} is ready to paste.`,
            color: 'success',
        });

    try {
        await copyImageBlobToClipboard(blob, { preferredMimeType: mime });
        showCopiedToast();
    } catch (error) {
        reportError(error, {
            code: 'ERR_INTERNAL',
            message: `Couldn't copy "${meta.name || 'image'}".`,
            tags: {
                domain: 'images',
                action: 'copy',
                hash: meta.hash,
                stage: 'clipboard-write',
            },
        });
    }
}

async function handleRename(meta: FileMeta) {
    const next = prompt('Rename image', meta.name);
    if (!next || next === meta.name) return;
    const old = meta.name;
    meta.name = next;
    try {
        await updateFileName(meta.hash, next);
        await imageSearch.rebuild();
        await imageSearch.search();
    } catch (error) {
        meta.name = old;
        reportError(error, {
            code: 'ERR_DB_WRITE_FAILED',
            message: `Couldn't rename "${old}".`,
            tags: { domain: 'images', action: 'rename', hash: meta.hash },
        });
    }
}

function openUploadPicker() {
    uploadInput.value?.click();
}

async function handleUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((file) =>
        file.type.startsWith('image/')
    );
    if (!files.length) return;
    uploading.value = true;
    try {
        for (const file of files) {
            await createOrRefFile(file, file.name || 'Uploaded image');
        }
        await refreshLibrary();
        setActiveView('uploads');
        toast.add({
            title: files.length === 1 ? 'Image uploaded' : 'Images uploaded',
            description: `${files.length} image${files.length === 1 ? '' : 's'} added to your library.`,
            color: 'success',
        });
    } catch (error) {
        reportError(error, {
            code: 'ERR_DB_WRITE_FAILED',
            message: 'Could not add the selected images.',
            tags: { domain: 'images', action: 'upload' },
        });
    } finally {
        uploading.value = false;
        input.value = '';
    }
}

function handleView(meta: FileMeta) {
    selected.value = meta;
    showViewer.value = true;
}

function setActiveView(view: ImageLibraryView) {
    if (isMutating.value || activeView.value === view) return;
    activeView.value = view;
    visibleLimit.value = PAGE_SIZE;
    selectionMode.value = false;
    clearSelection();
    selected.value = null;
    showViewer.value = false;
}

function toggleSelectionMode() {
    if (isMutating.value) return;
    const next = !selectionMode.value;
    selectionMode.value = next;
    if (!next) clearSelection();
}

function clearSelection() {
    selectedHashes.value = new Set();
}

function selectAllVisible() {
    if (!visibleItems.value.length) return;
    selectedHashes.value = new Set(visibleItems.value.map((item) => item.hash));
    if (selectedHashes.value.size > 0) {
        selectionMode.value = true;
    }
}

function toggleSelect(hash: string) {
    if (!hash) return;
    const next = new Set(selectedHashes.value);
    if (next.has(hash)) {
        next.delete(hash);
    } else {
        next.add(hash);
    }
    selectedHashes.value = next;
    if (next.size > 0) selectionMode.value = true;
}

function removeHashesFromState(hashes: string[]) {
    if (!hashes.length) {
        return { removedHashes: [] as string[], remaining: [] as string[] };
    }
    const removal = new Set(hashes);
    const removedSet = new Set<string>();
    items.value = items.value.filter((item) => {
        if (removal.has(item.hash)) {
            removedSet.add(item.hash);
            return false;
        }
        return true;
    });
    const nextSelected = new Set<string>();
    for (const hash of selectedHashes.value) {
        if (!removedSet.has(hash)) nextSelected.add(hash);
    }
    selectedHashes.value = nextSelected;
    if (selected.value && removedSet.has(selected.value.hash)) {
        selected.value = null;
        showViewer.value = false;
    }
    const remaining = hashes.filter((hash) => !removedSet.has(hash));
    return { removedHashes: Array.from(removedSet), remaining };
}

async function executeDeleteByMode(
    hashes: string[],
    options: {
        mode: 'soft-delete' | 'hard-delete';
        confirmMessage: string;
        successMessage: (count: number) => string;
        successTitle: string;
        successColor: 'success' | 'error';
        failedErrorMessage: string;
        failedToastTitle: string;
    }
): Promise<DeleteOutcome> {
    const attempted = Array.from(new Set(hashes.filter(Boolean)));
    if (!attempted.length) {
        return { attempted, removed: [], remaining: [], aborted: true };
    }
    if (typeof window !== 'undefined') {
        const ok = window.confirm(options.confirmMessage);
        if (!ok) {
            return {
                attempted,
                removed: [],
                remaining: attempted,
                aborted: true,
            };
        }
    }
    mutationState.value = options.mode;
    try {
        if (options.mode === 'hard-delete') {
            await hardDeleteMany(attempted);
        } else {
            await softDeleteMany(attempted);
        }
        const { removedHashes, remaining } = removeHashesFromState(attempted);
        await refreshLibrary();
        if (removedHashes.length > 0) {
            toast.add({
                title: options.successTitle,
                description: options.successMessage(removedHashes.length),
                color: options.successColor,
            });
        }
        if (remaining.length > 0) {
            toast.add({
                title: 'Some images remain',
                description:
                    'A few selected items are still present. Please retry.',
                color: 'warning',
            });
        }
        return {
            attempted,
            removed: removedHashes,
            remaining,
            aborted: false,
        };
    } catch (error) {
        const wrapped = fileDeleteError(options.failedErrorMessage, error);
        reportError(wrapped);
        toast.add({
            title: options.failedToastTitle,
            description: 'We could not remove the selected images.',
            color: 'error',
        });
        return {
            attempted,
            removed: [],
            remaining: attempted,
            aborted: false,
        };
    } finally {
        mutationState.value = 'idle';
    }
}

async function executeDelete(
    hashes: string[],
    confirmMessage: string,
    successMessage: (count: number) => string
): Promise<DeleteOutcome> {
    return executeDeleteByMode(hashes, {
        mode: 'soft-delete',
        confirmMessage,
        successMessage,
        successTitle: 'Images deleted',
        successColor: 'success',
        failedErrorMessage: 'Failed to delete images',
        failedToastTitle: 'Delete failed',
    });
}

async function executeHardDelete(
    hashes: string[],
    confirmMessage: string,
    successMessage: (count: number) => string
): Promise<DeleteOutcome> {
    return executeDeleteByMode(hashes, {
        mode: 'hard-delete',
        confirmMessage,
        successMessage,
        successTitle: 'Images permanently deleted',
        successColor: 'error',
        failedErrorMessage: 'Failed to permanently delete images',
        failedToastTitle: 'Permanent delete failed',
    });
}

async function executeRestore(
    hashes: string[],
    successMessage: (count: number) => string
): Promise<RestoreOutcome> {
    const attempted = Array.from(new Set(hashes.filter(Boolean)));
    if (!attempted.length) {
        return { attempted, restored: [], remaining: [], aborted: true };
    }
    mutationState.value = 'restore';
    try {
        await restoreMany(attempted);
        const { removedHashes, remaining } = removeHashesFromState(attempted);
        await refreshLibrary();
        if (removedHashes.length > 0) {
            toast.add({
                title: 'Images restored',
                description: successMessage(removedHashes.length),
                color: 'success',
            });
        }
        if (remaining.length > 0) {
            toast.add({
                title: 'Some images were not restored',
                description:
                    'A few selected items are still in the trash. Please retry.',
                color: 'warning',
            });
        }
        return {
            attempted,
            restored: removedHashes,
            remaining,
            aborted: false,
        };
    } catch (error) {
        reportError(error, {
            code: 'ERR_DB_WRITE_FAILED',
            message: 'Failed to restore images.',
            tags: { domain: 'images', action: 'restore' },
        });
        toast.add({
            title: 'Restore failed',
            description: 'We could not restore the selected images.',
            color: 'error',
        });
        return {
            attempted,
            restored: [],
            remaining: attempted,
            aborted: false,
        };
    } finally {
        mutationState.value = 'idle';
    }
}

async function deleteSingle(meta: FileMeta | null) {
    if (!meta) return false;
    const name = meta.name || 'this image';
    if (trashMode.value) {
        const confirmMessage = `Permanently delete "${name}"? This cannot be undone.`;
        const outcome = await executeHardDelete(
            [meta.hash],
            confirmMessage,
            () => `Permanently deleted "${name}".`
        );
        if (outcome.removed.length > 0 && outcome.remaining.length === 0) {
            clearSelection();
            selectionMode.value = false;
        }
        return outcome.removed.length > 0;
    }
    const confirmMessage = `Delete "${name}"? This cannot be undone.`;
    const outcome = await executeDelete(
        [meta.hash],
        confirmMessage,
        () => `Removed "${name}".`
    );
    if (outcome.removed.length > 0 && outcome.remaining.length === 0) {
        clearSelection();
        selectionMode.value = false;
    }
    return outcome.removed.length > 0;
}

async function deleteSelected() {
    const hashes = Array.from(selectedHashes.value);
    if (!hashes.length) return false;
    const count = hashes.length;
    if (trashMode.value) {
        const confirmMessage = `Permanently delete ${count} image${
            count === 1 ? '' : 's'
        }? This cannot be undone.`;
        const outcome = await executeHardDelete(
            hashes,
            confirmMessage,
            (removedCount) =>
                `${removedCount} image${
                    removedCount === 1 ? '' : 's'
                } permanently deleted.`
        );
        if (outcome.removed.length > 0 && outcome.remaining.length === 0) {
            clearSelection();
            selectionMode.value = false;
        }
        return outcome.removed.length > 0;
    }
    const confirmMessage = `Delete ${count} image${
        count === 1 ? '' : 's'
    }? This cannot be undone.`;
    const outcome = await executeDelete(
        hashes,
        confirmMessage,
        (removedCount) =>
            `${removedCount} image${removedCount === 1 ? '' : 's'} removed.`
    );
    if (outcome.removed.length > 0 && outcome.remaining.length === 0) {
        clearSelection();
        selectionMode.value = false;
    }
    return outcome.removed.length > 0;
}

const handleDeleteSelectedClick = async () => {
    await deleteSelected();
};

async function restoreSingle(meta: FileMeta | null) {
    if (!meta) return false;
    const name = meta.name || 'this image';
    const outcome = await executeRestore(
        [meta.hash],
        () => `Restored "${name}".`
    );
    if (outcome.restored.length > 0 && outcome.remaining.length === 0) {
        clearSelection();
        selectionMode.value = false;
    }
    return outcome.restored.length > 0;
}

const handleRestoreSelectedClick = async () => {
    await restoreSelected();
};

async function restoreSelected() {
    const hashes = Array.from(selectedHashes.value);
    if (!hashes.length) return false;
    const outcome = await executeRestore(
        hashes,
        (restoredCount) =>
            `${restoredCount} image${restoredCount === 1 ? '' : 's'} restored.`
    );
    if (outcome.restored.length > 0 && outcome.remaining.length === 0) {
        clearSelection();
        selectionMode.value = false;
    }
    return outcome.restored.length > 0;
}

const selectionToggleButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'images',
        identifier: 'images.selection-toggle',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        class: 'px-3 py-1 text-sm',
        type: 'button' as const,
        ...overrides.value,
    };
});

const selectAllButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'images',
        identifier: 'images.select-all',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        class: 'px-3 py-1 text-sm',
        type: 'button' as const,
        ...overrides.value,
    };
});

const restoreSelectedButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'images',
        identifier: 'images.restore',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'success' as const,
        class: 'px-3 py-1 text-sm',
        type: 'button' as const,
        ...overrides.value,
    };
});

const deletePermanentlyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'images',
        identifier: 'images.delete',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'error' as const,
        class: 'px-3 py-1 text-sm',
        type: 'button' as const,
        ...overrides.value,
    };
});

const clearSelectionButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'images',
        identifier: 'images.clear-selection',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        class: 'px-3 py-1 text-sm',
        type: 'button' as const,
        ...overrides.value,
    };
});

const deleteSelectionButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'images',
        identifier: 'images.delete-selection',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'error' as const,
        class: 'px-3 py-1 text-sm',
        type: 'button' as const,
        ...overrides.value,
    };
});

const loadMoreButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'images',
        identifier: 'images.load-more',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        class: 'px-3 py-1',
        type: 'button' as const,
        ...overrides.value,
    };
});

const uploadButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'images',
        identifier: 'images.upload',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'solid' as const,
        color: 'primary' as const,
        type: 'button' as const,
        ...overrides.value,
    };
});

const searchInputProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'input',
        context: 'images',
        identifier: 'images.search',
        isNuxtUI: true,
    });
    return {
        icon: useIcon('palette.search').value,
        size: 'md' as const,
        ...overrides.value,
    };
});
</script>

<template>
    <div
        class="image-library-page relative"
        :class="{ 'pb-24': selectionMode }"
    >
        <input
            ref="uploadInput"
            class="sr-only"
            type="file"
            accept="image/*"
            multiple
            @change="handleUpload"
        />

        <header class="image-library-header">
            <div>
                <p class="dashboard-page-eyebrow">Workspace</p>
                <h1 class="dashboard-page-title">
                    {{ trashMode ? 'Image trash' : 'Image library' }}
                </h1>
                <p class="dashboard-page-description">
                    {{
                        trashMode
                            ? 'Restore deleted images or remove them permanently.'
                            : 'Search, manage, and reuse generated and uploaded images.'
                    }}
                </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <UButton
                    v-if="!trashMode"
                    v-bind="uploadButtonProps"
                    :loading="uploading"
                    :disabled="isMutating"
                    @click="openUploadPicker"
                >
                    <UIcon
                        :name="useIcon('dashboard.restore').value"
                        class="mr-0.5"
                    />
                    Upload images
                </UButton>
                <UButton
                    v-bind="selectionToggleButtonProps"
                    data-test="multi-toggle"
                    @click="toggleSelectionMode"
                    :disabled="isMutating"
                >
                    <UIcon
                        :name="useIcon('image.multiple').value"
                        class="mr-0.5"
                    />
                    {{ selectionMode ? 'Cancel' : 'Select' }}
                </UButton>
            </div>
        </header>

        <div class="image-library-shell">
            <aside class="image-library-nav" aria-label="Image library views">
                <button
                    v-for="view in libraryViews"
                    :key="view.id"
                    type="button"
                    class="image-library-nav-item"
                    :class="{
                        'image-library-nav-item--active':
                            activeView === view.id,
                    }"
                    :aria-current="activeView === view.id ? 'page' : undefined"
                    :data-test="
                        view.id === 'trash' ? 'trash-toggle' : undefined
                    "
                    @click="setActiveView(view.id)"
                >
                    <UIcon :name="view.icon" class="h-4 w-4 shrink-0" />
                    <span>{{ view.label }}</span>
                    <span class="ml-auto tabular-nums opacity-60">{{
                        counts[view.id]
                    }}</span>
                </button>

                <div class="image-library-summary">
                    <span class="text-xs opacity-65">Stored locally</span>
                    <strong>{{ counts.all }} active images</strong>
                    <span class="text-xs opacity-65">
                        Previews load only when visible.
                    </span>
                </div>
            </aside>

            <main class="min-w-0">
                <div class="image-library-toolbar">
                    <UInput
                        v-model="searchQuery"
                        v-bind="searchInputProps"
                        class="min-w-0 flex-1"
                        placeholder="Search by file name or type"
                        aria-label="Search images"
                    />
                    <USelect
                        v-model="sortMode"
                        :items="sortOptions"
                        value-key="value"
                        label-key="label"
                        class="w-full sm:w-44"
                        aria-label="Sort images"
                    />
                </div>

                <div class="image-library-results-meta">
                    <span>
                        {{ filteredItems.length }}
                        {{ filteredItems.length === 1 ? 'image' : 'images' }}
                    </span>
                    <span v-if="searchQuery" class="truncate">
                        matching “{{ searchQuery }}”
                    </span>
                </div>

                <div
                    v-if="selectionMode"
                    class="fixed inset-x-0 bottom-0 z-[1000] border-t-[var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container-high)]/80 backdrop-blur-md"
                >
                    <div
                        class="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 py-2"
                    >
                        <UButton
                            v-bind="selectionToggleButtonProps"
                            data-test="multi-toggle"
                            @click="toggleSelectionMode"
                            :disabled="isMutating"
                        >
                            {{ selectionMode ? 'Cancel' : 'Select' }}
                        </UButton>
                        <template v-if="trashMode">
                            <UButton
                                v-bind="selectAllButtonProps"
                                :disabled="!canSelectAll || isMutating"
                                @click="selectAllVisible"
                            >
                                {{
                                    canSelectAll
                                        ? `Select visible (${visibleItems.length})`
                                        : 'All selected'
                                }}
                            </UButton>
                            <UButton
                                v-bind="restoreSelectedButtonProps"
                                :disabled="!hasSelection || isMutating"
                                @click="handleRestoreSelectedClick"
                            >
                                {{
                                    isRestoring
                                        ? 'Restoring…'
                                        : `Restore (${selectedCount})`
                                }}
                            </UButton>
                            <UButton
                                v-bind="deletePermanentlyButtonProps"
                                :disabled="!hasSelection || isMutating"
                                data-test="delete-selected"
                                @click="handleDeleteSelectedClick"
                            >
                                {{
                                    isHardDeleting
                                        ? 'Deleting…'
                                        : `Delete permanently (${selectedCount})`
                                }}
                            </UButton>
                        </template>
                        <template v-else>
                            <UButton
                                v-bind="clearSelectionButtonProps"
                                :disabled="!hasSelection || isMutating"
                                @click="clearSelection"
                            >
                                Clear
                            </UButton>
                            <UButton
                                v-bind="deleteSelectionButtonProps"
                                :disabled="!hasSelection || isMutating"
                                data-test="delete-selected"
                                @click="handleDeleteSelectedClick"
                            >
                                {{
                                    isSoftDeleting
                                        ? 'Deleting…'
                                        : `Delete (${selectedCount})`
                                }}
                            </UButton>
                        </template>
                        <span
                            class="ml-auto text-sm opacity-80 hidden sm:inline"
                            data-test="selected-count"
                        >
                            Selected: {{ selectedCount }}
                        </span>
                    </div>
                </div>
                <GalleryGrid
                    :items="visibleItems"
                    :selection-mode="selectionMode"
                    :selected-hashes="selectedHashes"
                    :is-deleting="isMutating"
                    :trash-mode="trashMode"
                    @view="handleView"
                    @download="handleDownload"
                    @copy="handleCopy"
                    @rename="handleRename"
                    @delete="deleteSingle"
                    @toggle-select="toggleSelect"
                />
                <div
                    v-if="!loading && filteredItems.length === 0"
                    class="image-library-empty"
                >
                    <UIcon
                        :name="useIcon('dashboard.images').value"
                        class="h-8 w-8"
                    />
                    <strong>No images found</strong>
                    <span>
                        {{
                            searchQuery
                                ? 'Try another search or library view.'
                                : 'Add an image to get started.'
                        }}
                    </span>
                </div>
                <div
                    v-if="filteredItems.length > PAGE_SIZE"
                    class="mt-5 flex justify-center"
                >
                    <UButton
                        v-bind="loadMoreButtonProps"
                        :disabled="loading || done || isMutating"
                        @click="loadMore"
                    >
                        <span v-if="!done">{{
                            loading ? 'Loading…' : 'Load more'
                        }}</span>
                        <span v-else>All loaded</span>
                    </UButton>
                </div>
            </main>
        </div>
        <ImageViewer
            v-model="showViewer"
            :meta="selected"
            :trash-mode="trashMode"
            @download="handleDownload"
            @copy="handleCopy"
            @rename="handleRename"
            @delete="deleteSingle"
            @restore="restoreSingle"
        />
    </div>
</template>

<style scoped>
.image-library-page {
    width: min(100%, 1120px);
    min-height: 100%;
    margin-inline: auto;
    padding: 1.25rem;
}
.image-library-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
}
.image-library-shell {
    display: grid;
    gap: 1rem;
}
.image-library-nav {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    padding-bottom: 0.2rem;
}
.image-library-nav-item {
    display: flex;
    flex: 0 0 auto;
    min-width: max-content;
    min-height: 2.5rem;
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0.7rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    background: transparent;
    border: var(--md-border-width) solid transparent;
    border-radius: var(--md-border-radius);
    cursor: pointer;
    font-size: 0.74rem;
    text-align: left;
    white-space: nowrap;
}
.image-library-nav-item:hover {
    color: var(--md-on-surface);
    background: var(--md-surface-hover);
}
.image-library-nav-item--active {
    color: var(--md-on-primary-container);
    background: var(--md-primary-container);
    border-color: var(--md-outline-variant);
}
.image-library-summary {
    display: none;
}
.image-library-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    padding: 0.7rem;
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}
.image-library-results-meta {
    display: flex;
    gap: 0.35rem;
    padding: 0.65rem 0.15rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.68rem;
    opacity: 0.72;
}
.image-library-empty {
    display: flex;
    min-height: 14rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    background: var(--md-surface);
    border: var(--md-border-width) dashed var(--md-outline-variant);
    border-radius: var(--md-border-radius);
    text-align: center;
}
.image-library-empty span {
    font-size: 0.72rem;
    opacity: 0.7;
}
@media (min-width: 760px) {
    .image-library-page {
        padding: 1.5rem 1.75rem;
    }
    .image-library-shell {
        grid-template-columns: 10.5rem minmax(0, 1fr);
        align-items: start;
    }
    .image-library-nav {
        position: sticky;
        top: 0;
        flex-direction: column;
        overflow: visible;
        padding: 0.65rem;
        background: var(--md-surface);
        border: var(--md-border-width) solid var(--md-border-color);
        border-radius: var(--md-border-radius);
    }
    .image-library-nav-item {
        width: 100%;
        min-width: 0;
    }
    .image-library-summary {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        margin-top: 0.4rem;
        padding: 0.8rem 0.7rem 0.2rem;
        border-top: var(--md-border-width) solid var(--md-outline-variant);
    }
}
</style>
