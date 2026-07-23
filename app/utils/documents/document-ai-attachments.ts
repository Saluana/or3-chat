import { classifyKind, getMaxFileBytes } from '~/components/chat/file-upload-utils';

export const MAX_DOCUMENT_AI_ATTACHMENTS = 4;

export interface DocumentAiAttachment {
    name: string;
    mime: string;
    kind: 'image' | 'pdf';
    dataUrl: string;
}

const DATA_URL_PATTERN = /^data:([^;,]+)?((?:;[^;,=]+)*)?(;base64)?,([\s\S]*)$/iu;

function approxDataUrlBytes(dataUrl: string): number {
    const match = DATA_URL_PATTERN.exec(dataUrl);
    if (!match) return -1;
    const payload = match[4] ?? '';
    const isBase64 = Boolean(match[3]);
    if (!payload) return 0;
    if (!isBase64) return payload.length;
    // Base64 expands 3 bytes → 4 chars; ignore padding noise.
    return Math.floor((payload.length * 3) / 4);
}

/**
 * Re-validate Document AI attachments at submit time.
 * Panel checks are not trusted — clients can forge mime/kind/dataUrl.
 */
export function validateDocumentAiAttachment(
    attachment: DocumentAiAttachment,
    maxBytes: number = getMaxFileBytes(),
): void {
    if (attachment.kind !== 'image' && attachment.kind !== 'pdf') {
        throw new Error('Unsupported attachment kind.');
    }
    const mime = String(attachment.mime ?? '').trim().toLowerCase();
    const classified = classifyKind(mime);
    if (classified !== attachment.kind) {
        throw new Error(`Attachment “${attachment.name}” mime type does not match its kind.`);
    }

    const match = DATA_URL_PATTERN.exec(String(attachment.dataUrl ?? ''));
    if (!match) {
        throw new Error(`Attachment “${attachment.name}” must use a data: URL.`);
    }
    const dataMime = String(match[1] ?? '').trim().toLowerCase();
    if (attachment.kind === 'image') {
        if (!dataMime.startsWith('image/')) {
            throw new Error(`Attachment “${attachment.name}” is not an image data URL.`);
        }
    } else if (dataMime !== 'application/pdf') {
        throw new Error(`Attachment “${attachment.name}” is not a PDF data URL.`);
    }

    // Prefer the payload mime when present; reject mismatched declared mime.
    if (dataMime && mime && dataMime !== mime) {
        throw new Error(`Attachment “${attachment.name}” mime does not match its data URL.`);
    }

    const bytes = approxDataUrlBytes(attachment.dataUrl);
    if (bytes <= 0) {
        throw new Error(`Attachment “${attachment.name}” is empty.`);
    }
    if (bytes > maxBytes) {
        throw new Error(
            `Attachment “${attachment.name}” is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).`,
        );
    }
}

export function validateDocumentAiAttachments(
    attachments: readonly DocumentAiAttachment[],
    maxBytes: number = getMaxFileBytes(),
): DocumentAiAttachment[] {
    if (attachments.length > MAX_DOCUMENT_AI_ATTACHMENTS) {
        throw new Error(`Add up to ${MAX_DOCUMENT_AI_ATTACHMENTS} files.`);
    }
    for (const attachment of attachments) {
        validateDocumentAiAttachment(attachment, maxBytes);
    }
    return [...attachments];
}
