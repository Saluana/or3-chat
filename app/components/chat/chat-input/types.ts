import type { FileMeta } from '~/db/schema';

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
