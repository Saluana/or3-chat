import type { H3Event } from 'h3';
import type {
    PullRequest,
    PullResponse,
    PushBatch,
    PushResult,
    SyncScope,
} from '~~/shared/sync/types';

export interface SyncGatewayAdapter {
    id: string;
    pull(event: H3Event, input: PullRequest): Promise<PullResponse>;
    push(event: H3Event, input: PushBatch): Promise<PushResult>;
    updateCursor(
        event: H3Event,
        input: { scope: SyncScope; deviceId: string; version: number }
    ): Promise<void>;
    gcTombstones?(
        event: H3Event,
        input: { scope: SyncScope; retentionSeconds: number }
    ): Promise<void>;
    gcChangeLog?(
        event: H3Event,
        input: { scope: SyncScope; retentionSeconds: number }
    ): Promise<void>;
}
