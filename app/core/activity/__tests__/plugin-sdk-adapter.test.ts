import { describe, expect, it, vi } from 'vitest';
import { ActivityRegistry } from '../registry';
import { registerPluginActivitySource } from '../adapters/plugin-sdk';
import {
    pluginError,
    pluginOk,
    type PluginActivityEvent,
    type PluginActivitySource,
} from '@or3/plugin-sdk';

function source(overrides: Partial<PluginActivitySource> = {}): PluginActivitySource {
    return {
        id: 'example.agent',
        label: 'Example agent',
        actions: ['cancel', 'retry'],
        async list() {
            return pluginOk([
                {
                    id: 'run-1',
                    title: 'Run one',
                    status: 'running',
                    updatedAt: '2026-09-20T20:00:00.000Z',
                    startedAt: '2026-09-20T19:59:00.000Z',
                    actions: ['cancel'],
                },
            ]);
        },
        async get() {
            return pluginOk({
                id: 'run-1',
                title: 'Run one',
                status: 'succeeded',
                updatedAt: '2026-09-20T20:00:00.000Z',
                events: [
                    {
                        id: 'event-1',
                        runId: 'run-1',
                        type: 'message',
                        occurredAt: '2026-09-20T20:00:00.000Z',
                        payload: { text: 'done' },
                    },
                ],
            });
        },
        async executeAction() {
            return pluginOk(undefined);
        },
        ...overrides,
    };
}

describe('Plugin SDK Activity adapter', () => {
    it('maps summaries, details and actions into the host registry', async () => {
        const registry = new ActivityRegistry();
        const executeAction = vi.fn(async () => pluginOk(undefined));
        const handle = registerPluginActivitySource(
            registry,
            source({ executeAction })
        );

        await expect(registry.listRuns()).resolves.toMatchObject({
            runs: [
                {
                    sourceId: 'example.agent',
                    id: 'run-1',
                    kind: 'plugin',
                    actions: ['cancel'],
                },
            ],
            degradedSources: [],
        });
        await expect(registry.getRun('example.agent', 'run-1')).resolves.toMatchObject({
            ok: true,
            value: {
                sourceId: 'example.agent',
                events: [{ sourceId: 'example.agent', runId: 'run-1' }],
            },
        });
        await expect(
            registry.executeAction('example.agent', { runId: 'run-1', action: 'cancel' })
        ).resolves.toEqual({ ok: true, value: undefined });
        expect(executeAction).toHaveBeenCalledWith({ runId: 'run-1', action: 'cancel' });

        handle.dispose();
        await expect(registry.listRuns()).resolves.toMatchObject({ runs: [], degradedSources: [] });
    });

    it('contains a broken plugin source without affecting another source', async () => {
        const registry = new ActivityRegistry();
        registerPluginActivitySource(registry, source({
            id: 'broken.source',
            async list() {
                return pluginError('internal', 'source failed');
            },
        }));
        registerPluginActivitySource(registry, source({ id: 'healthy.source' }));

        const result = await registry.listRuns();
        expect(result.runs).toHaveLength(1);
        expect(result.runs[0]?.sourceId).toBe('healthy.source');
        expect(result.degradedSources).toMatchObject([
            { sourceId: 'broken.source', code: 'source_failure' },
        ]);
    });

    it('forwards and disposes live events', () => {
        const registry = new ActivityRegistry();
        let emit: ((event: PluginActivityEvent) => void) | undefined;
        const onEvent = vi.fn();
        const sourceWithEvents: PluginActivitySource = source({
            subscribe(input) {
                const callback = input.onEvent;
                emit = callback;
                return () => {
                    emit = undefined;
                };
            },
        });
        const handle = registerPluginActivitySource(registry, sourceWithEvents);
        const subscription = registry.subscribe({
            sourceIds: ['example.agent'],
            onEvent,
        });
        const event = {
            id: 'event-2',
            runId: 'run-1',
            type: 'status' as const,
            occurredAt: '2026-09-20T20:01:00.000Z',
            payload: { status: 'succeeded' },
        };
        // Access the source callback through the registry subscription by
        // triggering a second source registration callback is unnecessary; the
        // adapter's forwarding is covered by the shape assertion below.
        expect(subscription.disposed).toBe(false);
        expect(emit).toBeTypeOf('function');
        emit?.(event);
        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'example.agent', runId: 'run-1' }));
        subscription.dispose();
        handle.dispose();
        expect(subscription.disposed).toBe(true);
    });
});
