import { describe, expect, it, vi } from 'vitest';
import {
    activityOk,
    type ActivityEvent,
    type ActivitySource,
    type ActivitySubscriptionInput,
} from '~/core/activity/contract';
import { ActivityRegistry } from '~/core/activity/registry';
import { ActivityTimeline } from '~/core/activity/timeline';

describe('Activity source streaming integration', () => {
    it('streams through reconnect to one protected terminal timeline', () => {
        const listeners = new Set<ActivitySubscriptionInput['onEvent']>();
        const dispose = vi.fn();
        const source: ActivitySource = {
            id: 'fake.stream',
            label: 'Fake stream',
            async listRuns() {
                return activityOk([]);
            },
            subscribe(input) {
                listeners.add(input.onEvent);
                return () => {
                    listeners.delete(input.onEvent);
                    dispose();
                };
            },
        };
        const registry = new ActivityRegistry();
        registry.register(source);
        const timeline = new ActivityTimeline();
        const connect = () =>
            registry.subscribe({
                sourceIds: [source.id],
                runId: 'run-1',
                onEvent: (event) => timeline.ingest(event),
            });
        const emit = (event: ActivityEvent) => {
            for (const listener of [...listeners]) listener(event);
        };
        const base = {
            sourceId: source.id,
            runId: 'run-1',
            occurredAt: '2026-07-27T10:00:00Z',
        };
        const running: ActivityEvent = {
            ...base,
            id: 'status-running',
            type: 'status',
            sequence: 1,
            payload: { status: 'running' },
        };
        const chunk: ActivityEvent = {
            ...base,
            id: 'chunk-1',
            type: 'message',
            sequence: 2,
            coalesceKey: 'assistant',
            payload: { text: 'done', append: true },
        };
        const succeeded: ActivityEvent = {
            ...base,
            id: 'status-succeeded',
            type: 'status',
            sequence: 3,
            payload: { status: 'succeeded' },
        };

        const first = connect();
        emit(running);
        emit(chunk);
        first.dispose();

        const reconnected = connect();
        emit(running);
        emit(chunk);
        emit(succeeded);
        emit({
            ...base,
            id: 'late-running',
            type: 'status',
            sequence: 4,
            payload: { status: 'running' },
        });

        expect(timeline.status).toBe('succeeded');
        expect(timeline.events.map((event) => event.id)).toEqual([
            'status-running',
            'chunk-1',
            'status-succeeded',
        ]);
        reconnected.dispose();
        expect(dispose).toHaveBeenCalledTimes(2);
        expect(listeners.size).toBe(0);
    });
});

