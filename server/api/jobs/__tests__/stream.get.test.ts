import { describe, it, expect, beforeAll } from 'vitest';
import type { BackgroundJob } from '../../../utils/background-jobs/types';

let serializeJobStatus: typeof import('../[id]/stream.get').serializeJobStatus;

const baseJob: BackgroundJob = {
    id: 'job-1',
    userId: 'user-1',
    threadId: 'thread-1',
    messageId: 'msg-1',
    model: 'model-1',
    status: 'streaming',
    content: 'Hello world',
    chunksReceived: 3,
    startedAt: 123,
};

beforeAll(async () => {
    const globalAny = globalThis as typeof globalThis & {
        defineEventHandler?: (handler: unknown) => unknown;
    };

    if (!globalAny.defineEventHandler) {
        globalAny.defineEventHandler = (handler) => handler;
    }

    const mod = await import('../[id]/stream.get');
    serializeJobStatus = mod.serializeJobStatus;
});

describe('serializeJobStatus', () => {
    it('includes content by default', () => {
        const status = serializeJobStatus(baseJob);

        expect(status.content).toBe(baseJob.content);
        expect(status.content_length).toBe(baseJob.content.length);
    });

    it('omits content when includeContent is false', () => {
        const status = serializeJobStatus(baseJob, {
            includeContent: false,
            content_delta: '!',
            content_length: baseJob.content.length + 1,
        });

        expect(status.content).toBeUndefined();
        expect(status.content_delta).toBe('!');
        expect(status.content_length).toBe(baseJob.content.length + 1);
    });
});
