export type FileTransferDirection = 'upload' | 'download';

export type FileTransferState =
    | 'queued'
    | 'running'
    | 'paused'
    | 'failed'
    | 'done';

export interface FileTransfer {
    id: string;
    hash: string;
    workspace_id: string;
    direction: FileTransferDirection;
    bytes_total: number;
    bytes_done: number;
    state: FileTransferState;
    attempts: number;
    last_error?: string;
    created_at: number;
    updated_at: number;
}
