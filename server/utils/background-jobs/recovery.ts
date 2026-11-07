/**
 * A client that has an older (or unknown) execution attempt must receive a
 * full snapshot before applying any more deltas.
 */
export function shouldResetBackgroundContent(
    clientAttempt: number | null,
    currentAttempt: number,
    offset: number | null
): boolean {
    if (clientAttempt !== null && Number.isFinite(clientAttempt)) {
        return clientAttempt !== currentAttempt;
    }
    return typeof offset === 'number' && Number.isFinite(offset) && offset > 0;
}

/** Process-local observations of the actual recovery loop, reset at restart. */
let recoveryObservation: { lastAttemptAt: number | null; lastSuccessAt: number | null; latestFailureAt: number | null; code: string | null } = { lastAttemptAt: null, lastSuccessAt: null, latestFailureAt: null, code: null };
export function recordBackgroundRecovery(outcome: 'success' | 'failure') {
    const now = Date.now();
    recoveryObservation = { ...recoveryObservation, lastAttemptAt: now,
        ...(outcome === 'success' ? { lastSuccessAt: now } : { latestFailureAt: now, code: 'recovery_phase_failed' }) };
}
export function getBackgroundRecoveryObservation() { return { ...recoveryObservation, coverage: 'this_process' as const }; }
