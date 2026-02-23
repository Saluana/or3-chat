import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createShutdownController } from '../../utils/shutdown/controller';

describe('graceful shutdown controller', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects new non-health requests once shutdown starts', async () => {
        const exitSpy = vi.fn();
        const exitProcess = (code: number): never => {
            exitSpy(code);
            throw new Error('exit');
        };

        const controller = createShutdownController({
            shutdownTimeoutMs: 5,
            drainPollMs: 1,
            getBackgroundJobCount: async () => 0,
            exitProcess,
        });

        await controller.startShutdown('SIGTERM').catch(() => undefined);

        expect(controller.isShuttingDown()).toBe(true);
        expect(controller.beginRequest('/api/admin/workspaces')).toBe(false);
        expect(controller.beginRequest('/api/health')).toBe(true);
    });

    it('waits for in-flight requests to drain before exit', async () => {
        const exitSpy = vi.fn();
        const exitProcess = (code: number): never => {
            exitSpy(code);
            throw new Error('exit');
        };

        const controller = createShutdownController({
            shutdownTimeoutMs: 100,
            drainPollMs: 1,
            getBackgroundJobCount: async () => 0,
            exitProcess,
        });

        expect(controller.beginRequest('/api/admin/workspaces')).toBe(true);
        expect(controller.getInFlightCount()).toBe(1);

        const shutdown = controller.startShutdown('SIGTERM').catch(() => undefined);

        await vi.waitFor(() => {
            expect(controller.isShuttingDown()).toBe(true);
        });

        controller.endRequest();
        await shutdown;

        expect(controller.getInFlightCount()).toBe(0);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('is idempotent when shutdown is triggered multiple times', async () => {
        const exitSpy = vi.fn();
        const exitProcess = (code: number): never => {
            exitSpy(code);
            throw new Error('exit');
        };

        const controller = createShutdownController({
            shutdownTimeoutMs: 5,
            drainPollMs: 1,
            getBackgroundJobCount: async () => 0,
            exitProcess,
        });

        await Promise.all([
            controller.startShutdown('SIGTERM').catch(() => undefined),
            controller.startShutdown('SIGINT').catch(() => undefined),
        ]);

        expect(exitSpy).toHaveBeenCalledTimes(1);
    });
});
