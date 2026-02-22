import { computed, nextTick, ref, watch, type Ref } from 'vue';
import { useDropZone, useFileDialog } from '@vueuse/core';
import { useToast } from '#imports';
import { reportError, err } from '~/utils/errors';
import { validateFile, persistAttachment } from '~/components/chat/file-upload-utils';
import type { LargeTextBlock, UploadedImage } from './types';

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
}

export function useChatInputAttachments(options: UseChatInputAttachmentsOptions) {
    const attachments = ref<UploadedImage[]>([]);
    const uploadedImages = computed(() => attachments.value);
    const largeTextBlocks = ref<LargeTextBlock[]>([]);
    const dropZoneRef = ref<HTMLElement | null>(null);
    const isDragging = ref(false);

    async function processAttachment(file: File, name?: string) {
        const toast = useToast();
        const mime = file.type || '';
        const validation = validateFile(file);
        if (!validation.ok) {
            reportError(err(validation.code, validation.message), {
                toast: true,
                tags: { domain: 'files', stage: 'select', mime, size: file.size },
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
        await persistAttachment(attachment);
    }

    async function processFiles(files: FileList | null) {
        if (!files) return;
        for (let i = 0; i < files.length; i++) {
            if (attachments.value.length >= options.maxFiles) {
                useToast().add({
                    title: 'Attachment limit reached',
                    description: `Maximum ${options.maxFiles} files per message.`,
                    color: 'warning',
                });
                break;
            }
            const file = files[i];
            if (!file) continue;
            await processAttachment(file);
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
        attachments.value.forEach(releaseAttachment);
        attachments.value = [];
        largeTextBlocks.value = [];
    }

    function releaseAll() {
        attachments.value.forEach(releaseAttachment);
    }

    async function handlePaste(event: ClipboardEvent, editor: EditorLike | null) {
        const cd = event.clipboardData;
        if (!cd) return;

        const items = cd.items;
        let handled = false;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (!it) continue;
            const mime = it.type || '';
            if (mime.startsWith('image/') || mime === 'application/pdf') {
                event.preventDefault();
                handled = true;
                const file = it.getAsFile();
                if (!file) continue;
                await processAttachment(
                    file,
                    file.name ||
                        `pasted-${mime.startsWith('image/') ? 'image' : 'pdf'}-${Date.now()}.${mime === 'application/pdf' ? 'pdf' : 'png'}`
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
        accept: 'image/*,application/pdf',
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
            for (const file of files) {
                processAttachment(file);
            }
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
        handlePaste,
        openFileDialog,
    };
}
