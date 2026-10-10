import type { FileMeta } from '~/db/schema';
import type { OpenRouterModelVariant } from '~~/shared/openrouter/model-variants';

export interface UploadedImage {
    file: File;
    url: string;
    name: string;
    hash?: string;
    status: 'pending' | 'ready' | 'error';
    error?: string;
    meta?: FileMeta;
    mime: string;
    kind: 'image' | 'pdf';
}

export interface LargeTextBlock {
    id: string;
    text: string;
    wordCount: number;
    preview: string;
    previewFull: string;
}

export interface ImageSettings {
    quality: 'low' | 'medium' | 'high';
    numResults: number;
    size: '1024x1024' | '1024x1536' | '1536x1024';
}

/** What a saved draft remembers about an attachment whose bytes live in `file_blobs`. */
export interface PersistedDraftAttachment {
    hash: string;
    name: string;
    mime: string;
    kind: UploadedImage['kind'];
}

export interface WorkspaceDraftComposerSettings {
    model: string;
    modelVariant: OpenRouterModelVariant;
    /** @deprecated Migrated to `modelVariant` (`true` maps to `'online'`). */
    webSearchEnabled?: boolean;
    thinkingEnabled: boolean;
    reasoningEffort?: string;
    imageSettings: ImageSettings;
}

/** Serialized draft row. No `File` or blob URL: those cannot survive a restart. */
export interface PersistedWorkspaceTabDraft {
    version: 1;
    text: string;
    editorJson?: Record<string, unknown>;
    attachments: PersistedDraftAttachment[];
    largeTextBlocks: LargeTextBlock[];
    composer?: WorkspaceDraftComposerSettings;
    updatedAt: number;
}
