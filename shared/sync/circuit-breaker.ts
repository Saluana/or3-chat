/**
 * SyncCircuitBreaker - Coordinated retry budget for sync operations
 *
 * Prevents retry storms when the server is overloaded by tracking
 * failure counts and implementing a shared cooldown period.
 *
 * Used by sync push/pull loops to coordinate retry behavior
 * and avoid compounding server load.
 */

/** Circuit breaker configuration */
export interface CircuitBreakerConfig {
    /** Number of failures before entering open state */
    failureThreshold?: number;
    /** Time in ms before resetting failure count */
    resetTimeoutMs?: number;
    /** Time in ms to wait in open state before allowing retry */
    openDurationMs?: number;
}

/** Circuit breaker state */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker implementation for coordinated retry management.
 *
 * States:
 * - closed: Normal operation, retries allowed
 * - open: Too many failures, retries blocked
 * - half-open: Testing if service recovered, single retry allowed
 */
export class SyncCircuitBreaker {
    private failureCount = 0;
    private lastFailureTime = 0;
    private openedAt = 0;
    private state: CircuitState = 'closed';

    private readonly failureThreshold: number;
    private readonly resetTimeoutMs: number;
    private readonly openDurationMs: number;

    constructor(config: CircuitBreakerConfig = {}) {
        this.failureThreshold = config.failureThreshold ?? 5;
        this.resetTimeoutMs = config.resetTimeoutMs ?? 60_000;
        this.openDurationMs = config.openDurationMs ?? 30_000;
    }

    /**
     * Check if a retry is allowed.
     * Returns true if the circuit is closed or half-open.
     */
    canRetry(): boolean {
        this.updateState();
        return this.state !== 'open';
    }

    /**
     * Record a successful operation.
     * Resets the circuit to closed state.
     */
    recordSuccess(): void {
        this.failureCount = 0;
        this.state = 'closed';
        this.openedAt = 0;
    }

    /**
     * Record a failed operation.
     * May trip the circuit to open state if threshold is exceeded.
     */
    recordFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.failureThreshold) {
            this.state = 'open';
            this.openedAt = Date.now();
        }
    }

    /**
     * Get the current circuit state.
     */
    getState(): CircuitState {
        this.updateState();
        return this.state;
    }

    /**
     * Get the number of consecutive failures.
     */
    getFailureCount(): number {
        return this.failureCount;
    }

    /**
     * Get time remaining in open state (0 if not open).
     */
    getTimeUntilRetry(): number {
        if (this.state !== 'open') return 0;
        const elapsed = Date.now() - this.openedAt;
        return Math.max(0, this.openDurationMs - elapsed);
    }

    /**
     * Force reset the circuit to closed state.
     * Use sparingly - typically for user-initiated retries.
     */
    reset(): void {
        this.failureCount = 0;
        this.state = 'closed';
        this.openedAt = 0;
        this.lastFailureTime = 0;
    }

    /**
     * Update state based on timeouts.
     */
    private updateState(): void {
        const now = Date.now();

        // Reset failure count if enough time has passed since last failure
        if (
            this.state === 'closed' &&
            this.failureCount > 0 &&
            now - this.lastFailureTime > this.resetTimeoutMs
        ) {
            this.failureCount = 0;
        }

        // Transition from open to half-open after cooldown
        if (this.state === 'open' && now - this.openedAt > this.openDurationMs) {
            this.state = 'half-open';
        }
    }
}

// Singleton instance for app-wide coordination
let globalCircuitBreaker: SyncCircuitBreaker | null = null;

/**
 * Get the global sync circuit breaker instance.
 * Creates one if it doesn't exist.
 */
export function getSyncCircuitBreaker(): SyncCircuitBreaker {
    if (!globalCircuitBreaker) {
        globalCircuitBreaker = new SyncCircuitBreaker();
    }
    return globalCircuitBreaker;
}

/**
 * Reset the global circuit breaker (for testing).
 */
export function _resetSyncCircuitBreaker(): void {
    globalCircuitBreaker?.reset();
    globalCircuitBreaker = null;
}
