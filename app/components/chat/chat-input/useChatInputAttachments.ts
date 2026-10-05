import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import {
    getActiveWorkspaceId,
    getDb,
    getWorkspaceGeneration,
    subscribeActiveWorkspaceDb,
} from '~/db/client';
import { useDropZone, useFileDialog } from '@vueuse/core';
import { useToast } from '#imports';
import { reportError, err } from '~/utils/errors';
import {
    getMaxFileBytes,
    validateFile,
    persistAttachment,
} from '~/components/chat/file-upload-utils';
import type { LargeTextBlock, UploadedImage } from './types';
import type { AttachmentIntakeOwner } from '../file-upload-utils';

type EditorLike = {
    getText: () => string;
    commands: {
        setContent: (
            content: string,
            options?: { emitUpdate?: boolean }
        ) => unknown;
    };
};

const LARGE_TEXT_WORD_THRESHOLD = 600;

function makeId() {
    return Math.random().toString(36).slice(2, 9);
}

function makePreviewUrl(file: File): string {
    try {
        return URL.createObjectURL(file);
    } catch {
        return '';
    }
}

function releaseAttachment(attachment: UploadedImage) {
    try {
        if (attachment.url && attachment.url.startsWith('blob:')) {
            URL.revokeObjectURL(attachment.url);
        }
    } catch {
        // noop
    }
}

interface UseChatInputAttachmentsOptions {
    maxFiles: number;
    onImageAdd: (attachment: UploadedImage) => void;
    onImageRemove: (index: number) => void;
    onTextFile?: (file: File, owner: AttachmentIntakeOwner) => Promise<void>;
    ownerKey?: () => string | undefined;
}

export function useChatInputAttachments(
    options: UseChatInputAttachmentsOptions
) {
    const attachments = ref<UploadedImage[]>([]);
    const uploadedImages = computed(() => attachments.value);
    const largeTextBlocks = ref<LargeTextBlock[]>([]);
    const dropZoneRef = ref<HTMLElement | null>(null);
    const isDragging = ref(false);

    let disposed = false;
    let intakeController = new AbortController();
    function invalidateIntake() {
        intakeController.abort();
        intakeController = new AbortController();
    }
    function dispose() {
        disposed = true;
        invalidateIntake();
    }
    const unsubscribeWorkspace = subscribeActiveWorkspaceDb(invalidateIntake);
    if (options.ownerKey)
        watch(options.ownerKey, invalidateIntake, { flush: 'sync' });
    onScopeDispose(() => {
        dispose();
        unsubscribeWorkspace();
    });

    function captureIntake(): AttachmentIntakeOwner {
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const workspaceId = getActiveWorkspaceId();
        const ownerKey = options.ownerKey?.();
        const signal = intakeController.signal;
        return {
            signal,
            assertCurrent() {
                signal.throwIfAborted();
                if (
                    disposed ||
                    db !== getDb() ||
                    generation !== getWorkspaceGeneration() ||
                    workspaceId !== getActiveWorkspaceId() ||
                    ownerKey !== options.ownerKey?.()
                ) {
                    throw new DOMException(
                        'Attachment intake owner changed',
                        'AbortError'
                    );
                }
            },
        };
    }

    async function processAttachment(
        file: File,
        name?: string,
        owner = captureIntake()
    ) {
        try {
            owner.assertCurrent();
        } catch {
            return;
        }
        const toast = useToast();
        const mime = file.type || '';
        if (
            options.onTextFile &&
            !mime.startsWith('image/') &&
            mime !== 'application/pdf' &&
            /\.(txt|md|csv)$/iu.test(file.name)
        ) {
            try {
                if (file.size > getMaxFileBytes())
                    throw new Error(
                        'File exceeds the configured upload limit.'
                    );
                await options.onTextFile(file, owner);
            } catch (error) {
                if (owner.signal.aborted) return;
                reportError(error, {
                    toast: true,
                    tags: { domain: 'files', stage: 'text-upload' },
                });
            }
            return;
        }
        const validation = validateFile(file);
        if (!validation.ok) {
            reportError(err(validation.code, validation.message), {
                toast: true,
                tags: {
                    domain: 'files',
                    stage: 'select',
                    mime,
                    size: file.size,
                },
            });
            return;
        }

        if (attachments.value.length >= options.maxFiles) {
            toast.add({
                title: 'Attachment limit reached',
                description: `Maximum ${options.maxFiles} files per message.`,
                color: 'warning',
            });
            return;
        }

        const attachment: UploadedImage = {
            file,
            url: makePreviewUrl(file),
            name: name || file.name,
            status: 'pending',
            mime,
            kind: validation.kind,
        };

        attachments.value.push(attachment);
        options.onImageAdd(attachment);
        await persistAttachment(attachment, owner);
        try {
            owner.assertCurrent();
        } catch {
            return;
        }
        return attachment;
    }

    async function processFiles(files: FileList | File[] | null) {
        if (!files) return;
        // The dialog resets its input immediately after this call. FileList
        // is live, so capture every selected file before the first await.
        const selected = Array.from(files);
        const owner = captureIntake();
        for (const file of selected) {
            try {
                owner.assertCurrent();
            } catch {
                break;
            }
            if (attachments.value.length >= options.maxFiles) {
                useToast().add({
                    title: 'Attachment limit reached',
                    description: `Maximum ${options.maxFiles} files per message.`,
                    color: 'warning',
                });
                break;
            }
            await processAttachment(file, undefined, owner);
        }
    }

    function removeImage(index: number) {
        const [removed] = attachments.value.splice(index, 1);
        if (removed) releaseAttachment(removed);
        options.onImageRemove(index);
    }

    function removeTextBlock(index: number) {
        largeTextBlocks.value.splice(index, 1);
    }

    function clearAll() {
        invalidateIntake();
        attachments.value.forEach(releaseAttachment);
        attachments.value = [];
        largeTextBlocks.value = [];
    }

    function releaseAll() {
        invalidateIntake();
        attachments.value.forEach(releaseAttachment);
    }

    /** Transfer ownership between tab drafts without revoking live blob URLs. */
    function replaceDraft(
        nextAttachments: UploadedImage[],
        nextLargeTextBlocks: LargeTextBlock[]
    ) {
        invalidateIntake();
        attachments.value = nextAttachments;
        largeTextBlocks.value = nextLargeTextBlocks;
    }

    async function handlePaste(
        event: ClipboardEvent,
        editor: EditorLike | null
    ) {
        const cd = event.clipboardData;
        if (!cd) return;

        const items = Array.from(cd.items, (item) => ({
            type: item.type,
            file: item.getAsFile(),
        }));
        const owner = captureIntake();
        let handled = false;
        for (let i = 0; i < items.length; i++) {
            try {
                owner.assertCurrent();
            } catch {
                return;
            }
            const it = items[i];
            if (!it) continue;
            const mime = it.type || '';
            if (mime.startsWith('image/') || mime === 'application/pdf') {
                event.preventDefault();
                handled = true;
                const file = it.file;
                if (!file) continue;
                await processAttachment(
                    file,
                    file.name ||
                        `pasted-${mime.startsWith('image/') ? 'image' : 'pdf'}-${Date.now()}.${mime === 'application/pdf' ? 'pdf' : 'png'}`,
                    owner
                );
            }
        }
        if (handled) return;

        const text = cd.getData('text/plain');
        if (!text) return;

        const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
        if (wordCount < LARGE_TEXT_WORD_THRESHOLD) return;

        event.preventDefault();
        event.stopPropagation();

        const prev = editor ? editor.getText() : '';
        const previewFull = text.slice(0, 800).trim();
        const preview =
            previewFull.split(/\s+/).slice(0, 12).join(' ') +
            (wordCount > 12 ? '…' : '');

        largeTextBlocks.value.push({
            id: makeId(),
            text,
            wordCount,
            preview,
            previewFull,
        });

        nextTick(() => {
            try {
                owner.assertCurrent();
                if (editor) {
                    editor.commands.setContent(prev, { emitUpdate: false });
                }
            } catch {
                // noop
            }
        });
    }

    const {
        files: selectedFiles,
        open: openFileDialog,
        reset: resetFileDialog,
    } = useFileDialog({
        accept: options.onTextFile
            ? 'image/*,application/pdf,.txt,.md,.csv'
            : 'image/*,application/pdf',
        multiple: true,
    });

    watch(selectedFiles, (files) => {
        if (!files) return;
        processFiles(files);
        resetFileDialog();
    });

    const { isOverDropZone } = useDropZone(dropZoneRef, {
        onDrop(files) {
            if (!files?.length) return;
            void processFiles(files);
        },
        dataTypes: (types) =>
            types.some(
                (type) =>
                    type.startsWith('image/') ||
                    type === 'application/pdf' ||
                    type === 'Files'
            ),
    });

    watch(
        isOverDropZone,
        (value) => {
            isDragging.value = value;
        },
        { immediate: true }
    );

    return {
        attachments,
        uploadedImages,
        largeTextBlocks,
        dropZoneRef,
        isDragging,
        processAttachment,
        removeImage,
        removeTextBlock,
        clearAll,
        releaseAll,
        dispose,
        replaceDraft,
        handlePaste,
        openFileDialog,
    };
}
