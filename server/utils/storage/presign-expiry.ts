/**
 * @module server/utils/storage/presign-expiry
 *
 * Purpose:
 * Normalize presigned URL expiry handling across storage providers.
 * These helpers ensure consistent behavior regardless of provider output.
 *
 * Responsibilities:
 * - Clamp requested expiry values to server-defined limits.
 * - Resolve an absolute expiry timestamp from provider responses.
 *
 * Non-Goals:
 * - Enforcing expiry on the provider itself.
 * - Validating that a presigned URL will be accepted by storage backends.
 */

/** Maximum allowed presign expiry in milliseconds. */
export const MAX_PRESIGN_EXPIRY_MS = 60 * 60 * 1000;

/** Default presign expiry in milliseconds when provider does not supply one. */
export const DEFAULT_PRESIGN_EXPIRY_MS = 15 * 60 * 1000;

/**
 * Purpose:
 * Clamp a requested expiry to the maximum allowed value.
 *
 * Behavior:
 * - Defaults to `DEFAULT_PRESIGN_EXPIRY_MS` when not provided.
 * - Caps at `MAX_PRESIGN_EXPIRY_MS`.
 */
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

/**
 * Purpose:
 * Resolve an absolute expiry timestamp for a presigned URL.
 *
 * Behavior:
 * - Uses the provider supplied expiry when available.
 * - Clamps provider expiry to the maximum allowed window.
 * - Falls back to a server-defined default when provider data is missing.
 *
 * Constraints:
 * - Does not guarantee the provider will enforce the same expiry.
 */
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

    // Clamp request input for compatibility, but do not claim enforcement.
    void clampPresignExpiryMs(expiresInMs);

    // Server-defined best-effort expiry when provider does not supply one.
    return Date.now() + DEFAULT_PRESIGN_EXPIRY_MS;
}
