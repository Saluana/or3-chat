/** Router-local model IDs are opaque outside the selected adapter. */
export interface ModelRef {
    routerId: string;
    modelId: string;
}

/** Missing metadata is different from an explicit lack of support. */
export type Capability = 'supported' | 'unsupported' | 'unknown';

/** Message parts shared by chat and inference without router-specific semantics. */
export type TextPart = { type: 'text'; text: string };
export type ImagePart = { type: 'image'; image: string | Uint8Array; mediaType?: string };
export type FilePart = { type: 'file'; data: string | Uint8Array; mediaType: string; name?: string };
export type ContentPart = TextPart | ImagePart | FilePart;

export interface ToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

/** Semantic message used by chat before provider-specific serialization. */
export interface AiMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | ContentPart[];
    name?: string;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
}

/** Text completion input. Router IDs and model IDs are interpreted by the selected adapter. */
export interface AiCompletionRequest {
    model: ModelRef;
    messages: readonly (Pick<AiMessage, 'role'> & { content: string })[];
    maxOutputTokens?: number;
    /** Omission leaves the model's default unchanged. */
    reasoning?: { kind: 'disabled' };
}

/** Streaming input; message and tool projections may retain an existing host compatibility contract. */
export interface AiStreamRequest<Message = AiMessage, Tool = unknown, Reasoning = unknown> {
    model: ModelRef;
    messages: Message[];
    modalities?: string[];
    reasoning?: Reasoning;
    tools?: Tool[];
}

/** A router may expose no options, and search and routing remain distinct. */
export interface ModelOptionDescriptor<Value extends string = string> {
    value: Value;
    label: string;
    description: string;
    kind: 'default' | 'routing' | 'search';
}

/** Completion content remains unknown until a consumer validates its own format. */
export interface AiCompletion {
    content?: unknown;
    finishReason?: unknown;
    usage?: unknown;
}
