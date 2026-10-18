import { describe, expect, it, vi } from 'vitest';
import { createApp, createError, eventHandler, toPlainHandler } from 'h3';
import { createShutdownController } from '../../utils/shutdown/controller';

vi.mock('nitropack/runtime', () => ({ defineNitroPlugin: (handler: unknown) => handler }));
const runtime = vi.hoisted(() => ({ controller: undefined as ReturnType<typeof createShutdownController> | undefined }));
vi.mock('../../utils/shutdown/runtime', () => ({ getShutdownRuntime: () => runtime }));
vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ auth: { enabled: true } }) }));

describe('graceful shutdown controller', () => {
    it.each(['CI', 'TEST'])('refuses a development controller when %s makes installed Nitro skip awaited worker cleanup', async flag => {
        vi.stubEnv(flag, '1'); vi.stubEnv('OR3_DEV_RESTART_SOCKET', '/tmp/not-a-qualified-development-controller.sock');
        const hooks = new Map<string, (...args: any[]) => unknown>();
        const control = await import('../../admin/system/server-control');
        const plugin = (await import('../96.restart-controller')).default;
        try {
            plugin({ hooks: { hook: (name: string, handler: (...args: any[]) => unknown) => { hooks.set(name, handler); } } } as never);
            expect(control.hasRestartController()).toBe(false);
        } finally { await hooks.get('close')?.(); vi.unstubAllEnvs(); }
    });
    it('releases an admitted handler that throws into an already-handled error response', async () => {
        const controller = createShutdownController({ shutdownTimeoutMs: 30, drainPollMs: 1, getBackgroundJobCount: async () => 0 });
        runtime.controller = controller;
        const hooks = new Map<string, (...args: any[]) => unknown>();
        const app = createApp({
            onRequest: event => hooks.get('request')?.(event) as void,
            onAfterResponse: event => hooks.get('afterResponse')?.(event) as void,
            onError: (_error, event) => { event.node.res.statusCode = 403; event.node.res.end('Forbidden'); },
        });
        app.use(eventHandler(() => { throw createError({ statusCode: 403 }); }));
        const plugin = (await import('../graceful-shutdown')).default;
        plugin({ h3App: app, hooks: { hook: (name: string, handler: (...args: any[]) => unknown) => { hooks.set(name, handler); } } } as never);
        try {
            expect((await toPlainHandler(app)({ path: '/api/sync/pull', method: 'POST', headers: {} })).status).toBe(403);
            expect(controller.getInFlightCount()).toBe(0);
            expect(await controller.prepare('after-error')).toEqual({ drained: true });
            expect(await controller.drainForRestart('after-error')).toEqual({ drained: true });
        } finally { await hooks.get('close')?.(); }
    });
    it('resumes admission promptly when preparation is cancelled while jobs remain', async () => {
        const controller = createShutdownController({ shutdownTimeoutMs: 100, drainPollMs: 5, getBackgroundJobCount: async () => 1 });
        const preparation = controller.prepare('cancelled', 2000);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(controller.cancel('cancelled')).toBe(true);
        const completed = await Promise.race([preparation.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]);
        expect(completed).toBe(true);
        expect(controller.canStartWork()).toBe(true);
    });
    it('cancels a stalled provider lookup promptly and permits another preparation', async () => {
        // A provider request may hang after the operator cancels. Its late result
        // must neither keep preparation busy nor affect a later operation.
        let finishLookup!: (count: number) => void;
        let lookups = 0;
        const controller = createShutdownController({
            shutdownTimeoutMs: 100, drainPollMs: 1,
            getBackgroundJobCount: () => ++lookups === 1 ? new Promise(resolve => { finishLookup = resolve; }) : Promise.resolve(0),
        });
        const preparation = controller.prepare('stalled', 2000);
        await vi.waitFor(() => expect(lookups).toBe(1));
        expect(controller.cancel('stalled')).toBe(true);
        try {
            expect(await Promise.race([preparation, new Promise(resolve => setTimeout(() => resolve('still_waiting'), 100))]))
                .toEqual({ drained: false, reason: 'work_active' });
            expect(await controller.prepare('next', 100)).toEqual({ drained: true });
            finishLookup(0);
            await preparation;
            expect(await controller.drainForRestart('next')).toEqual({ drained: true });
        } finally { finishLookup(0); await preparation; }
    });
    it('rejects new non-health requests once shutdown starts', async () => {
        const controller = createShutdownController({
            shutdownTimeoutMs: 5,
            drainPollMs: 1,
            getBackgroundJobCount: async () => 0,
        });

        await controller.startShutdown('SIGTERM').catch(() => undefined);

        expect(controller.isShuttingDown()).toBe(true);
        expect(controller.beginRequest('/api/admin/workspaces')).toBe(false);
        expect(controller.beginRequest('/api/health?deep=true')).toBe(true);
        // Session lookup can provision persistent state and must obey draining.
        expect(controller.beginRequest('/api/admin/auth/session?fresh=1')).toBe(false);
        expect(controller.beginRequest('/api/auth/session')).toBe(false);
        expect(controller.countsRequest('/api/admin/auth/session')).toBe(true);
        expect(controller.getInFlightCount()).toBe(0);
        expect(controller.beginRequest('/api/admin/auth/session', 'POST')).toBe(false);
    });

    it('waits for in-flight requests to drain before exit', async () => {
        const controller = createShutdownController({
            shutdownTimeoutMs: 100,
            drainPollMs: 1,
            getBackgroundJobCount: async () => 0,
        });

        expect(controller.beginRequest('/api/admin/workspaces')).toBe(true);
        expect(controller.getInFlightCount()).toBe(1);

        const shutdown = controller.startShutdown('SIGTERM');
        expect(controller.isShuttingDown()).toBe(true);

        controller.endRequest();
        expect(controller.getInFlightCount()).toBe(0);
        expect(await shutdown).toMatchObject({ drained: true });
    });

    it('is idempotent when shutdown is triggered multiple times', async () => {
        const controller = createShutdownController({
            shutdownTimeoutMs: 5,
            drainPollMs: 1,
            getBackgroundJobCount: async () => 0,
        });

        const shutdown = controller.startShutdown('SIGTERM');
        expect(controller.startShutdown('SIGINT')).toBe(shutdown);
        expect(await shutdown).toMatchObject({ drained: true });
    });

    it('bounds a hanging background lookup from the start of shutdown', async () => {
        const controller = createShutdownController({
            shutdownTimeoutMs: 25,
            drainPollMs: 1,
            getBackgroundJobCount: () => new Promise(() => {}),
        });
        const result = await Promise.race([
            controller.startShutdown('SIGTERM'),
            new Promise(resolve => setTimeout(() => resolve('unbounded'), 200)),
        ]);
        expect(result).toMatchObject({ drained: false, reason: 'drain_timeout' });
    });

    it('waits for active execution even without HTTP requests', async () => {
        let jobs = 1;
        const controller = createShutdownController({ shutdownTimeoutMs: 300, drainPollMs: 1, getBackgroundJobCount: async () => jobs });
        let settled = false;
        const shutdown = controller.startShutdown('SIGTERM').then(result => { settled = true; return result; });
        await new Promise(resolve => setTimeout(resolve, 15));
        expect(settled).toBe(false);
        jobs = 0;
        expect(await shutdown).toMatchObject({ drained: true });
    });

    it('cancels preparation safely when active work cannot finish', async () => {
        const controller = createShutdownController({ shutdownTimeoutMs: 100, drainPollMs: 1, getBackgroundJobCount: async () => 1 });
        expect(await controller.prepare('operation', 20)).toMatchObject({ drained: false, reason: 'work_active' });
        expect(controller.isShuttingDown()).toBe(false);
        expect(controller.beginRequest('/api/openrouter/stream', 'POST')).toBe(true);
    });

    it('tracks persistence independently of a disconnected response', async () => {
        const controller = createShutdownController({ shutdownTimeoutMs: 200, drainPollMs: 1, getBackgroundJobCount: async () => 0 });
        let finish!: () => void;
        const work = controller.track(new Promise<void>(resolve => { finish = resolve; }));
        let settled = false;
        const shutdown = controller.startShutdown('SIGTERM').then(result => { settled = true; return result; });
        await new Promise(resolve => setTimeout(resolve, 15));
        expect(settled).toBe(false);
        finish();
        await work;
        expect(await shutdown).toMatchObject({ drained: true });
    });
});
