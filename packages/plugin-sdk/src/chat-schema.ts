import type { PluginChatMessage } from './capabilities';

export interface PluginChatAttachment {
    readonly fileId: string;
    readonly name?: string;
    readonly mimeType?: string;
    readonly state?: 'pending' | 'ready' | 'failed';
}

export interface PluginChatApproval {
    readonly id: string;
    readonly title: string;
    readonly message: string;
    readonly action: 'approve' | 'deny';
}

export type PluginTranscriptEvent =
    | { readonly kind: 'text.delta'; readonly messageId: string; readonly text: string }
    | { readonly kind: 'message.completed'; readonly messageId: string }
    | { readonly kind: 'tool.started' | 'tool.completed'; readonly messageId: string; readonly toolId: string }
    | { readonly kind: 'approval.required'; readonly messageId: string; readonly approval: PluginChatApproval };

export interface PluginComposerState {
    readonly draft: string;
    readonly model?: string;
    readonly attachmentFileIds: readonly string[];
    readonly pendingApproval?: PluginChatApproval;
}

export type PluginChatValidation =
    | { readonly ok: true; readonly value: PluginChatMessage }
    | { readonly ok: false; readonly message: string };

const CHAT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_CHAT_CONTENT_BYTES = 256 * 1024;
const MAX_CHAT_ATTACHMENTS = 100;

export function validatePluginChatMessage(input: unknown): PluginChatValidation {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, message: 'chat message must be an object' };
    }
    const raw = input as Record<string, unknown>;
    if (raw.role !== 'user' && raw.role !== 'assistant' && raw.role !== 'system' && raw.role !== 'tool') {
        return { ok: false, message: 'chat message role is invalid' };
    }
    if (typeof raw.content !== 'string' || new TextEncoder().encode(raw.content).byteLength > MAX_CHAT_CONTENT_BYTES) {
        return { ok: false, message: `chat message content exceeds ${MAX_CHAT_CONTENT_BYTES} bytes or is not text` };
    }
    const fileIds = raw.fileIds === undefined ? [] : raw.fileIds;
    if (!Array.isArray(fileIds) || fileIds.length > MAX_CHAT_ATTACHMENTS || !fileIds.every((id) => typeof id === 'string' && CHAT_ID_PATTERN.test(id))) {
        return { ok: false, message: 'chat message fileIds are invalid' };
    }
    const attachments = raw.attachments === undefined ? undefined : raw.attachments;
    if (attachments !== undefined && (!Array.isArray(attachments) || attachments.length > MAX_CHAT_ATTACHMENTS)) {
        return { ok: false, message: 'chat message attachments are invalid' };
    }
    if (Array.isArray(attachments)) {
        for (const attachment of attachments) {
            if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
                return { ok: false, message: 'chat message attachment is invalid' };
            }
            const item = attachment as Record<string, unknown>;
            if (typeof item.fileId !== 'string' || !CHAT_ID_PATTERN.test(item.fileId)) {
                return { ok: false, message: 'chat message attachment fileId is invalid' };
            }
            if (
                item.name !== undefined &&
                (typeof item.name !== 'string' ||
                    item.name.length === 0 ||
                    item.name.length > 256 ||
                    /[\u0000-\u001f\u007f]/.test(item.name))
            ) {
                return { ok: false, message: 'chat message attachment name is invalid' };
            }
            if (item.mimeType !== undefined && (typeof item.mimeType !== 'string' || item.mimeType.length > 256)) {
                return { ok: false, message: 'chat message attachment mimeType is invalid' };
            }
            if (item.state !== undefined && item.state !== 'pending' && item.state !== 'ready' && item.state !== 'failed') {
                return { ok: false, message: 'chat message attachment state is invalid' };
            }
        }
    }
    return {
        ok: true,
        value: Object.freeze({
            role: raw.role,
            content: raw.content,
            ...(fileIds.length === 0 ? {} : { fileIds: [...fileIds] as string[] }),
            // Rebuild each attachment from its validated fields: retaining the
            // caller's array (or its element objects) would let a later
            // mutation smuggle an unauthorized fileId into the stored message.
            ...(attachments === undefined
                ? {}
                : {
                      attachments: attachments.map((attachment) => {
                          const item = attachment as Record<string, unknown>;
                          return Object.freeze({
                              fileId: item.fileId as string,
                              ...(item.name === undefined ? {} : { name: item.name as string }),
                              ...(item.mimeType === undefined
                                  ? {}
                                  : { mimeType: item.mimeType as string }),
                              ...(item.state === undefined ? {} : { state: item.state as 'pending' | 'ready' | 'failed' }),
                          });
                      }) as PluginChatAttachment[],
                  }),
        }) as PluginChatMessage,
    };
}
