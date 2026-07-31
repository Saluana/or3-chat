import { computed, type Ref } from 'vue';
import type { UploadedImage } from '~/components/chat/chat-input/types';

export function useChatAttachmentDisplay(
    attachments: Ref<UploadedImage[]>
) {
    const indexed = computed(() =>
        attachments.value.map((attachment, index) => ({
            ...attachment,
            index,
            key:
                attachment.hash ||
                attachment.url ||
                `${index}:${attachment.name}`,
        }))
    );
    const imageAttachments = computed(() =>
        indexed.value
            .filter((attachment) => attachment.kind === 'image')
            .map((attachment, displayIndex) => ({
                ...attachment,
                displayIndex,
            }))
    );
    const pdfAttachments = computed(() =>
        indexed.value.filter((attachment) => attachment.kind === 'pdf')
    );

    return { imageAttachments, pdfAttachments };
}
