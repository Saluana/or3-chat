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
