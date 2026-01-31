import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncCircuitBreaker } from '../circuit-breaker';

describe('SyncCircuitBreaker', () => {
    let breaker: SyncCircuitBreaker;

    beforeEach(() => {
        vi.useFakeTimers();
        breaker = new SyncCircuitBreaker({
            failureThreshold: 3,
            resetTimeoutMs: 1000,
            openDurationMs: 5000,
        });
    });

    it('starts closed', () => {
        expect(breaker.getState()).toBe('closed');
        expect(breaker.canRetry()).toBe(true);
    });

    it('opens after threshold failures', () => {
        breaker.recordFailure();
        breaker.recordFailure();
        expect(breaker.getState()).toBe('closed'); // 2/3

        breaker.recordFailure();
        expect(breaker.getState()).toBe('open'); // 3/3
        expect(breaker.canRetry()).toBe(false);
    });

    it('transitions to half-open after timeout', () => {
        breaker.recordFailure();
        breaker.recordFailure();
        breaker.recordFailure();
        expect(breaker.getState()).toBe('open');

        vi.advanceTimersByTime(5001);
        expect(breaker.getState()).toBe('half-open');
        expect(breaker.canRetry()).toBe(true);
    });

    it('resets to closed on success', () => {
        breaker.recordFailure();
        breaker.recordFailure();
        breaker.recordFailure();
        
        vi.advanceTimersByTime(5001);
        expect(breaker.getState()).toBe('half-open');
        
        breaker.recordSuccess();
        expect(breaker.getState()).toBe('closed');
        expect(breaker.getFailureCount()).toBe(0);
    });

    it('only allows one probe in half-open state', () => {
        breaker.recordFailure();
        breaker.recordFailure();
        breaker.recordFailure();
        
        vi.advanceTimersByTime(5001);
        expect(breaker.getState()).toBe('half-open'); // Ready to probe

        // First check allows retry (probe)
        expect(breaker.canRetry()).toBe(true);
        
        // checking again without recording success/failure should return false (probe in flight)
        expect(breaker.canRetry()).toBe(false); 
        expect(breaker.canRetry()).toBe(false);

        // If probe fails, fully open again
        breaker.recordFailure();
        expect(breaker.getState()).toBe('open');
        expect(breaker.canRetry()).toBe(false);
    });
});
