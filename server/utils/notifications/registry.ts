/**
 * @module server/utils/notifications/registry
 *
 * Purpose:
 * Registry for server-side notification emitters so provider packages
 * can supply implementations without core importing provider SDKs.
 */

export interface NotificationEmitter {
    emitBackgroundJobComplete(
        workspaceId: string,
        userId: string,
        threadId: string,
        jobId: string
    ): Promise<string | null>;
    emitBackgroundJobError(
        workspaceId: string,
        userId: string,
        threadId: string,
        jobId: string,
        error: string
    ): Promise<string | null>;
}

const emitters = new Map<string, NotificationEmitter>();

export function registerNotificationEmitter(
    id: string,
    emitter: NotificationEmitter
): void {
    emitters.set(id, emitter);
}

export function getNotificationEmitter(id: string): NotificationEmitter | null {
    return emitters.get(id) ?? null;
}

export function listNotificationEmitterIds(): string[] {
    return Array.from(emitters.keys());
}
