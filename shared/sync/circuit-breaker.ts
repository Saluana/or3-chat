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
    /** Maximum ownership lifetime for an abandoned half-open probe. */
    probeTimeoutMs?: number;
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
export interface SyncProbeLease {
    success(): void;
    failure(): void;
    cancel(): void;
}

export class SyncCircuitBreaker {
    private failureCount = 0;
    private lastFailureTime = 0;
    private openedAt = 0;
    private state: CircuitState = 'closed';
    private probeOwner: symbol | null = null;
    private probeExpiresAt = 0;
    private epoch = 0;

    private readonly failureThreshold: number;
    private readonly resetTimeoutMs: number;
    private readonly openDurationMs: number;
    private readonly probeTimeoutMs: number;

    constructor(config: CircuitBreakerConfig = {}) {
        this.failureThreshold = config.failureThreshold ?? 5;
        this.resetTimeoutMs = config.resetTimeoutMs ?? 60_000;
        this.openDurationMs = config.openDurationMs ?? 30_000;
        this.probeTimeoutMs = config.probeTimeoutMs ?? 60_000;
    }

    /**
     * Read-only check: whether a retry/probe may be attempted.
     * Does not claim the half-open probe slot.
     */
    canRetry(): boolean {
        this.updateState();
        if (this.state === 'closed') return true;
        if (this.state === 'open') return false;
        return this.probeOwner === null;
    }

    /** Each attempt owns its settlement, even if its lifecycle is cancelled. */
    acquireProbe(): SyncProbeLease | null {
        if (!this.canRetry()) return null;
        const owner = Symbol('sync-probe');
        if (this.state === 'half-open') {
            this.epoch++;
            this.probeOwner = owner;
            this.probeExpiresAt = Date.now() + this.probeTimeoutMs;
        }
        const epoch = this.epoch;
        let settled = false;
        const settle = (outcome: 'success' | 'failure' | 'cancel') => {
            this.updateState();
            if (settled || epoch !== this.epoch) return;
            settled = true;
            if (outcome === 'success') this.recordSuccess();
            else if (outcome === 'failure') this.recordFailure();
            else if (this.probeOwner === owner) {
                this.probeOwner = null;
                this.epoch++;
            }
        };
        return {
            success: () => settle('success'),
            failure: () => settle('failure'),
            cancel: () => settle('cancel'),
        };
    }

    /**
     * Record a successful operation.
     * Resets the circuit to closed state.
     */
    recordSuccess(): void {
        this.failureCount = 0;
        this.state = 'closed';
        this.openedAt = 0;
        this.probeOwner = null;
        this.epoch++;
    }

    /**
     * Record a failed operation.
     * May trip the circuit to open state if threshold is exceeded.
     */
    recordFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        this.probeOwner = null;
        this.epoch++;

        if (this.failureCount >= this.failureThreshold) {
            this.state = 'open';
            this.openedAt = Date.now();
        } else if (this.state === 'half-open') {
             // If we failed in half-open, immediately reopen
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
        this.probeOwner = null;
        this.epoch++;
    }

    /**
     * Update state based on timeouts.
     */
    private updateState(): void {
        const now = Date.now();
        if (this.probeOwner !== null && now >= this.probeExpiresAt) {
            this.probeOwner = null;
            this.epoch++;
        }

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

const DEFAULT_CIRCUIT_KEY = 'global';
const circuitBreakers = new Map<string, SyncCircuitBreaker>();

/**
 * Get a sync circuit breaker instance scoped to a key.
 * Use workspace/provider-specific keys to avoid cross-tenant throttling.
 */
export function getSyncCircuitBreaker(key: string = DEFAULT_CIRCUIT_KEY): SyncCircuitBreaker {
    const existing = circuitBreakers.get(key);
    if (existing) return existing;

    const created = new SyncCircuitBreaker();
    circuitBreakers.set(key, created);
    return created;
}

/**
 * Reset all circuit breakers (for testing).
 */
export function _resetSyncCircuitBreaker(): void {
    for (const breaker of circuitBreakers.values()) {
        breaker.reset();
    }
    circuitBreakers.clear();
}

/**
 * Remove circuit breaker instances for a workspace prefix.
 */
export function cleanupSyncCircuitBreakers(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    for (const key of circuitBreakers.keys()) {
        if (key.startsWith(prefix)) {
            circuitBreakers.delete(key);
        }
    }
}
