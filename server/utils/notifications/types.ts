export interface NotificationEmitter {
    id: string;
    emitBackgroundJobComplete(input: {
        workspaceId: string;
        userId: string;
        threadId: string;
        jobId: string;
    }): Promise<string>;
    emitBackgroundJobError(input: {
        workspaceId: string;
        userId: string;
        threadId: string;
        jobId: string;
        error: string;
    }): Promise<string>;
}
