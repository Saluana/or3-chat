/**
 * @module server/auth/metrics.ts
 *
 * Purpose:
 * Light-weight instrumentation for the auth subsystem. Tracks session resolution
 * success rates, authorization trends, and provider-level errors.
 *
 * Responsibilities:
 * - Maintain an in-memory counter of auth-related events.
 * - Provide read/reset access for diagnostic endpoints or tests.
 */

/**
 * Purpose:
 * Represents the structured metrics tracked by the auth system.
 */
export interface AuthMetrics {
    /** Total number of session resolution attempts. */
    sessionResolutions: number;
    /** Number of sessions that failed to resolve (not including anonymous). */
    sessionResolutionFailures: number;
    /** Total number of `can()` checks performed. */
    authorizationChecks: number;
    /** Number of `can()` checks that resulted in `allowed: false`. */
    authorizationDenials: number;
    /** Number of hard errors encountered by auth providers (network, API, etc). */
    providerErrors: number;
}

const metrics: AuthMetrics = {
    sessionResolutions: 0,
    sessionResolutionFailures: 0,
    authorizationChecks: 0,
    authorizationDenials: 0,
    providerErrors: 0,
};

/**
 * Purpose:
 * Increments session resolution counters.
 *
 * @param success - Whether the session was successfully resolved.
 */
export function recordSessionResolution(success: boolean): void {
    if (success) {
        metrics.sessionResolutions++;
    } else {
        metrics.sessionResolutionFailures++;
    }
}

/**
 * Purpose:
 * Increments authorization check counters.
 *
 * @param allowed - The resulting authorization decision.
 */
export function recordAuthorizationCheck(allowed: boolean): void {
    metrics.authorizationChecks++;
    if (!allowed) {
        metrics.authorizationDenials++;
    }
}

/**
 * Purpose:
 * Increments the provider error counter on hard failures.
 */
export function recordProviderError(): void {
    metrics.providerErrors++;
}

/**
 * Purpose:
 * Retrieves a snapshot of the current metrics.
 */
export function getMetrics(): Readonly<AuthMetrics> {
    return { ...metrics };
}

/**
 * Purpose:
 * Resets all counters to zero. Recommended for test isolation.
 */
export function resetMetrics(): void {
    Object.keys(metrics).forEach(k => {
        metrics[k as keyof AuthMetrics] = 0;
    });
}
