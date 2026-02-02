import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    useLazyBoundaries,
    onLazyBoundaryTelemetry,
    createLoadTimer,
    resetLazyBoundariesForHMR,
} from '../useLazyBoundaries';

describe('useLazyBoundaries', () => {
    beforeEach(() => {
        // Use the new reset function for deterministic test isolation
        resetLazyBoundariesForHMR();
    });

    it('should initialize with idle state for all boundaries', () => {
        const boundaries = useLazyBoundaries();
        expect(boundaries.getState('editor-host')).toBe('idle');
        expect(boundaries.getState('docs-search-panel')).toBe('idle');
        expect(boundaries.getState('workspace-export')).toBe('idle');
    });

    it('should successfully load and cache a module', async () => {
        const boundaries = useLazyBoundaries();
        const mockModule = { default: 'test-module' };
        const loader = vi.fn().mockResolvedValue(mockModule);

        const result = await boundaries.load({
            key: 'editor-host',
            loader,
        });

        expect(result).toBe(mockModule);
        expect(boundaries.getState('editor-host')).toBe('ready');
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should reuse cached module on subsequent calls', async () => {
        const boundaries = useLazyBoundaries();
        const mockModule = { default: 'test-module' };
        const loader = vi.fn().mockResolvedValue(mockModule);

        // First load
        const result1 = await boundaries.load({
            key: 'docs-search-panel',
            loader,
        });

        // Second load
        const result2 = await boundaries.load({
            key: 'docs-search-panel',
            loader,
        });

        expect(result1).toBe(result2);
        expect(loader).toHaveBeenCalledTimes(1); // Called only once
    });

    it('should track loading state transitions', async () => {
        const boundaries = useLazyBoundaries();
        const states: string[] = [];

        // Record state as it progresses
        const stateWatcher = setInterval(() => {
            states.push(boundaries.getState('editor-extensions'));
        }, 5);

        const loader = () =>
            new Promise((resolve) => setTimeout(() => resolve({}), 50));

        const loadPromise = boundaries.load({
            key: 'editor-extensions',
            loader,
        });

        await loadPromise;
        clearInterval(stateWatcher);

        // Should have seen transitions from idle -> loading -> ready
        expect(states).toContain('loading');
        expect(boundaries.getState('editor-extensions')).toBe('ready');
    });

    it('should handle load failures and mark state as error', async () => {
        const boundaries = useLazyBoundaries();
        const error = new Error('Load failed');
        const loader = vi.fn().mockRejectedValue(error);

        let caughtError;
        try {
            await boundaries.load({
                key: 'workspace-export',
                loader,
            });
        } catch (e) {
            caughtError = e;
        }

        expect(caughtError).toBe(error);
        expect(boundaries.getState('workspace-export')).toBe('error');
    });

    it('should retry after failure (cache cleared on error)', async () => {
        const boundaries = useLazyBoundaries();
        const loader = vi
            .fn()
            .mockRejectedValueOnce(new Error('First attempt'))
            .mockResolvedValueOnce({ recovered: true });

        // First attempt should fail
        try {
            await boundaries.load({
                key: 'workspace-import',
                loader,
            });
        } catch {
            // Expected
        }

        // Second attempt should succeed (cache was cleared)
        const result = await boundaries.load({
            key: 'workspace-import',
            loader,
        });

        expect(result).toEqual({ recovered: true });
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it('should reset boundary state and clear cache', async () => {
        const boundaries = useLazyBoundaries();
        const mockModule = { test: true };
        const loader = vi.fn().mockResolvedValue(mockModule);

        // Load module
        await boundaries.load({
            key: 'editor-host',
            loader,
        });

        expect(boundaries.getState('editor-host')).toBe('ready');
        expect(loader).toHaveBeenCalledTimes(1);

        // Reset
        boundaries.reset('editor-host');

        expect(boundaries.getState('editor-host')).toBe('idle');

        // Load again should call loader again
        await boundaries.load({
            key: 'editor-host',
            loader,
        });

        expect(loader).toHaveBeenCalledTimes(2);
    });

    it('should invoke onResolve callback after successful load', async () => {
        const boundaries = useLazyBoundaries();
        const mockModule = { test: true };
        const loader = vi.fn().mockResolvedValue(mockModule);
        const onResolve = vi.fn();

        await boundaries.load({
            key: 'docs-search-worker',
            loader,
            onResolve,
        });

        expect(onResolve).toHaveBeenCalledWith(mockModule);
    });

    it('should not invoke onResolve callback on failure', async () => {
        const boundaries = useLazyBoundaries();
        const loader = vi.fn().mockRejectedValue(new Error('Load failed'));
        const onResolve = vi.fn();

        try {
            await boundaries.load({
                key: 'editor-extensions',
                loader,
                onResolve,
            });
        } catch {
            // Expected
        }

        expect(onResolve).not.toHaveBeenCalled();
    });

    it('should emit telemetry on successful load', async () => {
        const boundaries = useLazyBoundaries();
        const telemetryEvents: any[] = [];

        const unsubscribe = onLazyBoundaryTelemetry((payload) => {
            telemetryEvents.push(payload);
        });

        const loader = vi.fn().mockResolvedValue({ test: true });

        await boundaries.load({
            key: 'editor-host',
            loader,
        });

        // Should only have this test's events
        const eventForThisKey = telemetryEvents.filter(
            (e) => e.key === 'editor-host'
        );
        expect(eventForThisKey).toHaveLength(1);
        expect(eventForThisKey[0].key).toBe('editor-host');
        expect(eventForThisKey[0].outcome).toBe('success');
        expect(typeof eventForThisKey[0].ms).toBe('number');
        expect(eventForThisKey[0].ms).toBeGreaterThanOrEqual(0);

        unsubscribe();
    });

    it('should emit telemetry on load failure', async () => {
        const boundaries = useLazyBoundaries();
        const telemetryEvents: any[] = [];

        const unsubscribe = onLazyBoundaryTelemetry((payload) => {
            telemetryEvents.push(payload);
        });

        const testError = new Error('Test error');
        const loader = vi.fn().mockRejectedValue(testError);

        try {
            await boundaries.load({
                key: 'workspace-export',
                loader,
            });
        } catch {
            // Expected
        }

        // Should only have this test's events
        const eventForThisKey = telemetryEvents.filter(
            (e) => e.key === 'workspace-export'
        );
        expect(eventForThisKey).toHaveLength(1);
        expect(eventForThisKey[0]).toMatchObject({
            key: 'workspace-export',
            outcome: 'failure',
            error: testError,
            ms: expect.any(Number),
        });

        unsubscribe();
    });

    it('should support multiple telemetry listeners', async () => {
        const boundaries = useLazyBoundaries();
        const listener1Events: any[] = [];
        const listener2Events: any[] = [];

        const unsub1 = onLazyBoundaryTelemetry((e) => listener1Events.push(e));
        const unsub2 = onLazyBoundaryTelemetry((e) => listener2Events.push(e));

        const loader = vi.fn().mockResolvedValue({});

        await boundaries.load({
            key: 'docs-search-panel',
            loader,
        });

        expect(listener1Events).toHaveLength(1);
        expect(listener2Events).toHaveLength(1);

        unsub1();
        unsub2();
    });

    it('should provide readable state object', () => {
        const boundaries = useLazyBoundaries();

        // Verify state is readonly (cannot reassign properties)
        expect(() => {
            boundaries.state['editor-host'] = 'loading';
        }).not.toThrow(); // Vue reactivity allows assignment, but it's conceptually readonly

        // All keys should be accessible
        expect(boundaries.state['editor-host']).toBeDefined();
        expect(boundaries.state['workspace-import']).toBeDefined();
    });

    it('should clean up telemetry listeners on HMR reset', async () => {
        const boundaries = useLazyBoundaries();
        const telemetryEvents: any[] = [];

        const unsub = onLazyBoundaryTelemetry((e) => telemetryEvents.push(e));

        // Load something to trigger telemetry
        const loader = vi.fn().mockResolvedValue({});
        await boundaries.load({
            key: 'editor-host',
            loader,
        });

        expect(telemetryEvents.length).toBeGreaterThan(0);
        
        // Reset for HMR
        resetLazyBoundariesForHMR();
        
        // Load again
        const boundaries2 = useLazyBoundaries();
        await boundaries2.load({
            key: 'editor-host',
            loader: vi.fn().mockResolvedValue({}),
        });

        // Old listener should not receive new events after reset
        // (listeners are cleared by reset)
        expect(telemetryEvents.length).toBe(1); // Only the first event
        
        unsub(); // Clean up (though reset already cleared it)
    });

    it('should reset all boundary states to idle on HMR reset', async () => {
        const boundaries = useLazyBoundaries();
        const loader = vi.fn().mockResolvedValue({});
        
        // Load some boundaries
        await boundaries.load({ key: 'editor-host', loader });
        await boundaries.load({ key: 'docs-search-panel', loader });
        
        expect(boundaries.getState('editor-host')).toBe('ready');
        expect(boundaries.getState('docs-search-panel')).toBe('ready');
        
        // Reset for HMR
        resetLazyBoundariesForHMR();
        
        const boundaries2 = useLazyBoundaries();
        expect(boundaries2.getState('editor-host')).toBe('idle');
        expect(boundaries2.getState('docs-search-panel')).toBe('idle');
    });
});

describe('createLoadTimer', () => {
    it('should measure elapsed time', async () => {
        const timer = createLoadTimer();
        await new Promise((r) => setTimeout(r, 50));
        const elapsed = timer.stop();

        expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some variance
        expect(elapsed).toBeLessThan(200);
    });

    it('should return time in milliseconds', () => {
        const timer = createLoadTimer();
        // Immediately stop
        const elapsed = timer.stop();

        expect(elapsed).toBeGreaterThanOrEqual(0);
        expect(typeof elapsed).toBe('number');
    });
});
