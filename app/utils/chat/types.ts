export type TextPart = { type: 'text'; text: string };

export type ImagePart = {
    type: 'image';
    image: string | Uint8Array | Buffer;
    mediaType?: string;
};

export type FilePart = {
    type: 'file';
    data: string | Uint8Array | Buffer;
    mediaType: string;
    name?: string;
};

export type ContentPart = TextPart | ImagePart | FilePart;

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string | ContentPart[];
    id?: string;
    stream_id?: string;
    file_hashes?: string | null;
    reasoning_text?: string | null;
}

export interface SendMessageParams {
    files?: { type: string; url: string }[];
    model?: string;
    file_hashes?: string[];
    extraTextParts?: string[];
    online: boolean;
}

export type ORStreamEvent =
    | { type: 'text'; text: string }
    | { type: 'image'; url: string; final?: boolean; index?: number }
    | { type: 'reasoning'; text: string }
    | { type: 'done' };
