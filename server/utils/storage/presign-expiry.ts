/**
 * Presign expiry helpers.
 * Provides consistent expiry handling across storage gateway endpoints.
 */

export const MAX_PRESIGN_EXPIRY_MS = 60 * 60 * 1000;
export const DEFAULT_PRESIGN_EXPIRY_MS = 15 * 60 * 1000;

export function clampPresignExpiryMs(expiresInMs?: number): number {
    return Math.min(
        expiresInMs ?? DEFAULT_PRESIGN_EXPIRY_MS,
        MAX_PRESIGN_EXPIRY_MS
    );
}

function parseExpiresAt(value: unknown): number | null {
    if (!value) return null;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

export function resolvePresignExpiresAt(
    providerResult: unknown,
    expiresInMs?: number
): number {
    const result = providerResult as Record<string, unknown> | null | undefined;
    const providerExpiresAt = result
        ? parseExpiresAt(result.expiresAt ?? result.expires_at)
        : null;

    if (providerExpiresAt !== null) {
        const maxExpiresAt = Date.now() + MAX_PRESIGN_EXPIRY_MS;
        return Math.min(providerExpiresAt, maxExpiresAt);
    }

    // Clamp request input (for future provider compatibility), but do not
    // pretend client-chosen expiry is enforced when provider has no expiry.
    void clampPresignExpiryMs(expiresInMs);

    // Server-defined best-effort expiry when provider does not supply one.
    return Date.now() + DEFAULT_PRESIGN_EXPIRY_MS;
}
