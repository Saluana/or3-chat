import { describe, expect, it, vi } from 'vitest';
import {
    activityErr,
    activityOk,
    type ActivityEvent,
    type ActivitySource,
} from '../contract';
import { ActivityRegistry } from '../registry';
import { ActivityTimeline } from '../timeline';

function summary(sourceId: string, id: string, updatedAt = '2026-07-27T10:00:00Z') {
    return {
        id,
        sourceId,
        title: `Run ${id}`,
        kind: 'workflow',
        status: 'running' as const,
        startedAt: '2026-07-27T09:00:00Z',
        updatedAt,
        actions: ['cancel' as const],
    };
}

function source(
    id: string,
    overrides: Partial<ActivitySource> = {}
): ActivitySource {
    return {
        id,
        label: id,
        actions: ['cancel'],
        async listRuns() {
            return activityOk([summary(id, `${id}-run`)]);
        },
        ...overrides,
    };
}

function event(
    id: string,
    type: ActivityEvent['type'],
    payload: Record<string, unknown>,
    extra: Partial<ActivityEvent> = {}
): ActivityEvent {
    return {
        id,
        sourceId: 'workflow',
        runId: 'run-1',
        type,
        occurredAt: '2026-07-27T10:00:00Z',
        payload,
        ...extra,
    };
}

describe('ActivityRegistry', () => {
    it('registers with exact ownership and idempotent disposal', () => {
        const registry = new ActivityRegistry();
        const handle = registry.register(source('workflow'));
        expect(registry.get('workflow')).toBeDefined();
        expect(handle.dispose()).toBe(true);
        expect(handle.dispose()).toBe(false);
        expect(registry.get('workflow')).toBeUndefined();
    });

    it('rejects duplicate source IDs', () => {
        const registry = new ActivityRegistry();
        registry.register(source('workflow'));
        expect(() => registry.register(source('workflow'))).toThrow(
            'already registered'
        );
    });

    it('isolates failed sources and keeps valid runs sorted', async () => {
        const registry = new ActivityRegistry();
        registry.register(
            source('broken', {
                async listRuns() {
                    throw new Error('offline');
                },
            })
        );
        registry.register(
            source('workflow', {
                async listRuns() {
                    return activityOk([
                        summary('workflow', 'older', '2026-07-27T08:00:00Z'),
                        summary('workflow', 'newer', '2026-07-27T11:00:00Z'),
                    ]);
                },
            })
        );

        const result = await registry.listRuns();
        expect(result.runs.map((run) => run.id)).toEqual(['newer', 'older']);
        expect(result.degradedSources).toMatchObject([
            { code: 'source_failure', sourceId: 'broken' },
        ]);
    });

    it('does not dispatch unsupported actions', async () => {
        const executeAction = vi.fn(async () => activityOk(undefined));
        const registry = new ActivityRegistry();
        registry.register(
            source('workflow', {
                actions: ['cancel'],
                executeAction,
            })
        );

        const result = await registry.executeAction('workflow', {
            runId: 'run-1',
            action: 'retry',
        });
        expect(result).toMatchObject({
            ok: false,
            error: { code: 'capability_unavailable' },
        });
        expect(executeAction).not.toHaveBeenCalled();
    });

    it('dispatches supported actions and preserves source errors', async () => {
        const executeAction = vi.fn(async () =>
            activityErr({
                code: 'source_failure',
                message: 'remote rejected cancellation',
                sourceId: 'workflow',
            })
        );
        const registry = new ActivityRegistry();
        registry.register(
            source('workflow', {
                actions: ['cancel'],
                executeAction,
            })
        );

        const result = await registry.executeAction('workflow', {
            runId: 'run-1',
            action: 'cancel',
        });
        expect(executeAction).toHaveBeenCalledOnce();
        expect(result).toMatchObject({
            ok: false,
            error: { message: 'remote rejected cancellation' },
        });
    });

    it('rejects invalid detail identities and event ownership', async () => {
        const registry = new ActivityRegistry();
        registry.register(
            source('workflow', {
                async getRun() {
                    return activityOk({
                        ...summary('workflow', 'run-1'),
                        events: [
                            event('event-1', 'message', { text: 'wrong' }, {
                                runId: 'another-run',
                            }),
                        ],
                    });
                },
            })
        );

        await expect(registry.getRun('workflow', 'run-1')).resolves.toMatchObject({
            ok: false,
            error: { code: 'invalid_input' },
        });
    });

    it('isolates subscription failures and cleans every live source', () => {
        const firstDispose = vi.fn();
        const lastDispose = vi.fn();
        const registry = new ActivityRegistry();
        registry.register(
            source('a', { subscribe: () => firstDispose })
        );
        registry.register(
            source('b', {
                subscribe() {
                    throw new Error('disconnected');
                },
            })
        );
        registry.register(
            source('c', { subscribe: () => lastDispose })
        );

        const subscription = registry.subscribe({
            onEvent: vi.fn(),
        });
        expect(subscription.degradedSources).toMatchObject([
            { sourceId: 'b', code: 'source_failure' },
        ]);
        subscription.dispose();
        subscription.dispose();
        expect(firstDispose).toHaveBeenCalledOnce();
        expect(lastDispose).toHaveBeenCalledOnce();
    });

    it('rejects invalid events without breaking a subscription', () => {
        const onEvent = vi.fn();
        const onError = vi.fn();
        const registry = new ActivityRegistry();
        registry.register(
            source('workflow', {
                subscribe(input) {
                    input.onEvent(
                        event('wrong', 'message', { text: 'bad' }, {
                            sourceId: 'another-source',
                        })
                    );
                    input.onEvent(event('right', 'message', { text: 'good' }));
                },
            })
        );
        registry.subscribe({ onEvent, onError });
        expect(onError).toHaveBeenCalledOnce();
        expect(onEvent).toHaveBeenCalledOnce();
        expect(onEvent.mock.calls[0]?.[0].id).toBe('right');
    });
});

describe('ActivityTimeline', () => {
    it('deduplicates stable event IDs', () => {
        const timeline = new ActivityTimeline();
        const item = event('message-1', 'message', { text: 'hello' });
        expect(timeline.ingest(item)).toBe(true);
        expect(timeline.ingest(item)).toBe(false);
        expect(timeline.events).toHaveLength(1);
    });

    it('coalesces streaming text by key', () => {
        const timeline = new ActivityTimeline();
        timeline.ingest(
            event('chunk-1', 'message', { text: 'hel', append: true }, {
                coalesceKey: 'assistant',
                sequence: 1,
            })
        );
        timeline.ingest(
            event('chunk-2', 'message', { text: 'lo', append: true }, {
                coalesceKey: 'assistant',
                sequence: 2,
            })
        );
        expect(timeline.events).toHaveLength(1);
        expect(timeline.events[0]?.payload.text).toBe('hello');
    });

    it('protects terminal status from stale and regressive updates', () => {
        const timeline = new ActivityTimeline();
        timeline.ingest(
            event('running', 'status', { status: 'running' }, { sequence: 1 })
        );
        timeline.ingest(
            event('done', 'status', { status: 'succeeded' }, { sequence: 3 })
        );
        expect(
            timeline.ingest(
                event('late-running', 'status', { status: 'running' }, {
                    sequence: 4,
                })
            )
        ).toBe(false);
        expect(
            timeline.ingest(
                event('old-message', 'message', { text: 'old' }, {
                    sequence: 2,
                })
            )
        ).toBe(false);
        expect(timeline.status).toBe('succeeded');
    });

    it('does not accept an unknown status into reducer state', () => {
        const timeline = new ActivityTimeline();
        expect(
            timeline.ingest(
                event('unknown', 'status', { status: 'banana' })
            )
        ).toBe(true);
        expect(timeline.status).toBeUndefined();
    });

    it('bounds retained projections', () => {
        const timeline = new ActivityTimeline({ maxEvents: 2 });
        timeline.ingest(event('1', 'message', { text: 'one' }));
        timeline.ingest(event('2', 'message', { text: 'two' }));
        timeline.ingest(event('3', 'message', { text: 'three' }));
        expect(timeline.events.map((item) => item.id)).toEqual(['2', '3']);
    });
});
