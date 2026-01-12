export interface PresignedUrlResult {
    url: string;
    headers?: Record<string, string>;
    expiresAt: number;
    storageId?: string;
    method?: string;
}

export interface ObjectStorageProvider {
    id: string;
    displayName: string;
    mode?: 'gateway';
    supports: {
        presignedUpload: boolean;
        presignedDownload: boolean;
        multipart?: boolean;
    };

    getPresignedUploadUrl(input: {
        workspaceId: string;
        hash: string;
        mimeType: string;
        sizeBytes: number;
        expiresInMs?: number;
        disposition?: string;
    }): Promise<PresignedUrlResult>;

    getPresignedDownloadUrl(input: {
        workspaceId: string;
        hash: string;
        storageId?: string;
        expiresInMs?: number;
        disposition?: string;
    }): Promise<PresignedUrlResult>;

    commitUpload?(input: {
        workspaceId: string;
        hash: string;
        storageId: string;
        meta: {
            name: string;
            mimeType: string;
            sizeBytes: number;
            kind: 'image' | 'pdf';
            width?: number;
            height?: number;
            pageCount?: number;
        };
        storageProviderId?: string;
    }): Promise<void>;

    deleteObject?(input: {
        workspaceId: string;
        hash: string;
        storageId?: string;
    }): Promise<void>;
}
