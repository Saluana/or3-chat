/**
 * Multimodal message and attachment normalization for workflow execution.
 */
import type { Attachment, ChatMessage } from 'or3-workflow-core';
import type { OpenRouterMessage } from '~/core/hooks/hook-types';
import { nowSec } from '~/db/util';
import type { ChatHistoryMessage } from '~/utils/chat/workflow-types';

export type MessagesPayload =
    | { messages: OpenRouterMessage[] }
    | { messages: OpenRouterMessage[] }[];

export function normalizeMessagesPayload(
    payload: MessagesPayload
): OpenRouterMessage[] {
    if (Array.isArray(payload)) {
        return payload.flatMap((entry) => entry.messages);
    }
    return Array.isArray(payload.messages) ? payload.messages : [];
}

function parseDataUrlMimeType(url: string): string | null {
    const match = /^data:([^;]+);base64,/i.exec(url);
    return match?.[1]?.toLowerCase() ?? null;
}

const imageExtensionByMime: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function extractImageUrl(part: unknown): string | null {
    if (!isRecord(part)) return null;
    const type = typeof part.type === 'string' ? part.type : '';
    if (type === 'image_url') {
        const imageUrl = part.image_url;
        if (typeof imageUrl === 'string') return imageUrl;
        if (isRecord(imageUrl) && typeof imageUrl.url === 'string') {
            return imageUrl.url;
        }
        const camel = part.imageUrl;
        return isRecord(camel) && typeof camel.url === 'string'
            ? camel.url
            : null;
    }
    return type === 'image' && typeof part.image === 'string'
        ? part.image
        : null;
}

export function toChatHistoryMessage(
    message: ChatMessage
): ChatHistoryMessage {
    const content =
        typeof message.content === 'string'
            ? message.content
            : message.content
                  .map((part) => {
                      if (part.type === 'text') return part.text;
                      if (part.type === 'image_url') {
                          return `[Image: ${part.imageUrl.url}]`;
                      }
                      if (part.type === 'file') {
                          return `[File: ${part.file.filename}]`;
                      }
                      return '';
                  })
                  .join(' ');
    return {
        role: message.role as 'user' | 'assistant' | 'system',
        content,
    };
}

type FilePartCandidate = {
    data?: unknown;
    fileData?: unknown;
    file_data?: unknown;
    mediaType?: unknown;
    mimeType?: unknown;
    mime?: unknown;
    name?: unknown;
    filename?: unknown;
    file?: {
        fileData?: unknown;
        file_data?: unknown;
        data?: unknown;
        filename?: unknown;
        name?: unknown;
        mediaType?: unknown;
        mimeType?: unknown;
        mime?: unknown;
    };
};

function extractFilePart(part: unknown): {
    fileData: string;
    filename?: string;
    mimeType?: string;
} | null {
    if (!isRecord(part) || part.type !== 'file') return null;
    const filePart = part as FilePartCandidate;
    const nested = isRecord(filePart.file) ? filePart.file : undefined;
    const fileData =
        filePart.data ||
        filePart.fileData ||
        filePart.file_data ||
        nested?.fileData ||
        nested?.file_data ||
        nested?.data;
    if (typeof fileData !== 'string') return null;

    const filename =
        (typeof filePart.name === 'string' && filePart.name) ||
        (typeof filePart.filename === 'string' && filePart.filename) ||
        (typeof nested?.filename === 'string' && nested.filename) ||
        (typeof nested?.name === 'string' && nested.name) ||
        undefined;
    const mimeType =
        (typeof filePart.mediaType === 'string' && filePart.mediaType) ||
        (typeof filePart.mimeType === 'string' && filePart.mimeType) ||
        (typeof filePart.mime === 'string' && filePart.mime) ||
        (typeof nested?.mediaType === 'string' && nested.mediaType) ||
        (typeof nested?.mimeType === 'string' && nested.mimeType) ||
        (typeof nested?.mime === 'string' && nested.mime) ||
        undefined;
    return { fileData, filename, mimeType };
}

export function extractImageAttachments(
    content: OpenRouterMessage['content'],
    timestamp: number
): Attachment[] {
    if (!Array.isArray(content)) return [];
    const attachments: Attachment[] = [];
    let imageIndex = 0;
    let fileIndex = 0;

    for (const part of content) {
        const url = extractImageUrl(part);
        if (url) {
            const mimeType = parseDataUrlMimeType(url) || 'image/png';
            attachments.push({
                id: `att-${timestamp}-${imageIndex}`,
                type: 'image',
                url,
                mimeType,
                name: `image-${imageIndex}.${imageExtensionByMime[mimeType] || 'png'}`,
            });
            imageIndex++;
            continue;
        }

        const file = extractFilePart(part);
        if (!file) continue;
        const dataUrlMime = file.fileData.startsWith('data:')
            ? parseDataUrlMimeType(file.fileData)
            : null;
        let mimeType =
            file.mimeType?.toLowerCase() ||
            dataUrlMime ||
            'application/octet-stream';
        if (
            mimeType === 'application/octet-stream' &&
            file.filename?.toLowerCase().endsWith('.pdf')
        ) {
            mimeType = 'application/pdf';
        }
        attachments.push({
            id: `att-file-${timestamp}-${fileIndex}`,
            type: 'file',
            url: file.fileData,
            mimeType,
            name: file.filename || `file-${fileIndex}`,
        });
        fileIndex++;
    }
    return attachments;
}

async function blobToDataUrl(
    blob: Blob,
    mimeType?: string
): Promise<string> {
    const normalized = mimeType ? new Blob([blob], { type: mimeType }) : blob;
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () =>
            reject(reader.error ?? new Error('FileReader error'));
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(normalized);
    });
}

function toArrayBuffer(
    input: ArrayBuffer | SharedArrayBuffer
): ArrayBuffer {
    if (input instanceof ArrayBuffer) return input;
    const copy = new Uint8Array(input.byteLength);
    copy.set(new Uint8Array(input));
    return copy.buffer;
}

export async function normalizeAttachmentUrl(
    value: unknown,
    mimeType: string
): Promise<string | null> {
    if (typeof value === 'string') return value;
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
        return blobToDataUrl(value, mimeType || value.type);
    }
    if (value instanceof ArrayBuffer) {
        return blobToDataUrl(
            new Blob([value], { type: mimeType }),
            mimeType
        );
    }
    if (
        typeof SharedArrayBuffer !== 'undefined' &&
        value instanceof SharedArrayBuffer
    ) {
        return blobToDataUrl(
            new Blob([toArrayBuffer(value)], { type: mimeType }),
            mimeType
        );
    }
    if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView;
        const buffer = toArrayBuffer(view.buffer).slice(
            view.byteOffset,
            view.byteOffset + view.byteLength
        );
        return blobToDataUrl(new Blob([buffer], { type: mimeType }), mimeType);
    }
    return null;
}

export function inheritAttachmentsFromMessages(
    messages: OpenRouterMessage[],
    limit = 8
): Attachment[] {
    const collected: Attachment[] = [];
    const seen = new Set<string>();
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (!message) continue;
        for (const attachment of extractImageAttachments(
            message.content,
            nowSec()
        )) {
            const key = attachment.url || attachment.id;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            collected.push(attachment);
            if (collected.length >= limit) return collected;
        }
    }
    return collected;
}
