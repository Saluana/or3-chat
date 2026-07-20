export const FOREGROUND_GENERATION_LEASE_MS = 30_000;

export type ForegroundGenerationLease = {
    generation_lease_id: string;
    generation_heartbeat_at: number;
};

export function createForegroundGenerationLease(
    requestId: string,
    now = Date.now()
): ForegroundGenerationLease {
    return {
        generation_lease_id: requestId,
        generation_heartbeat_at: now,
    };
}

export function isStaleForegroundGeneration(
    message: {
        role?: string;
        pending?: boolean;
        data?: Record<string, unknown> | null;
    },
    now = Date.now()
): boolean {
    if (message.role !== 'assistant' || message.pending !== true) return false;
    if (typeof message.data?.background_job_id === 'string') return false;
    const heartbeat = message.data?.generation_heartbeat_at;
    return (
        typeof heartbeat !== 'number' ||
        !Number.isFinite(heartbeat) ||
        now - heartbeat >= FOREGROUND_GENERATION_LEASE_MS
    );
}

export function remainingForegroundLeaseMs(
    message: { data?: Record<string, unknown> | null },
    now = Date.now()
): number {
    const heartbeat = message.data?.generation_heartbeat_at;
    if (typeof heartbeat !== 'number' || !Number.isFinite(heartbeat)) return 0;
    return Math.max(0, FOREGROUND_GENERATION_LEASE_MS - (now - heartbeat));
}
