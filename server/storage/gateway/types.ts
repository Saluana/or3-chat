import type { H3Event } from 'h3';

export interface StorageGatewayAdapter {
    id: string;
    presignUpload(
        event: H3Event,
        input: {
            workspaceId: string;
            hash: string;
            mimeType: string;
            sizeBytes: number;
            expiresInMs?: number;
            disposition?: string;
        }
    ): Promise<{
        url: string;
        expiresAt: number;
        headers?: Record<string, string>;
        storageId?: string;
        method?: string;
    }>;
    presignDownload(
        event: H3Event,
        input: {
            workspaceId: string;
            hash: string;
            storageId?: string;
            expiresInMs?: number;
            disposition?: string;
        }
    ): Promise<{
        url: string;
        expiresAt: number;
        headers?: Record<string, string>;
        storageId?: string;
        method?: string;
    }>;
    commit?(
        event: H3Event,
        input: {
            workspaceId: string;
            hash: string;
            storageId?: string;
            storageProviderId?: string;
            meta: {
                name: string;
                mimeType: string;
                sizeBytes: number;
                kind?: string;
                width?: number | null;
                height?: number | null;
                pageCount?: number | null;
            };
        }
    ): Promise<void>;
    gc?(event: H3Event, input: { retentionSeconds: number }): Promise<unknown>;
}
