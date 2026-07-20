export type FileTransferDirection = 'upload' | 'download';

export type FileTransferState =
    | 'queued'
    | 'running'
    | 'pending_upload'
    | 'remote_missing'
    | 'paused'
    | 'failed'
    | 'done';

export type RecoverableFileTransferState = 'pending_upload' | 'remote_missing';

export interface FileTransfer {
    id: string;
    hash: string;
    workspace_id: string;
    direction: FileTransferDirection;
    bytes_total: number;
    bytes_done: number;
    state: FileTransferState;
    attempts: number;
    last_attempt_at?: number;
    lease_owner?: string;
    lease_expires_at?: number;
    retry_at?: number;
    last_error?: string;
    created_at: number;
    updated_at: number;
}
