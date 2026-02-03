/**
 * @module server/utils/normalize-host
 *
 * Purpose:
 * Canonicalizes host strings for access control and allowlist checks.
 * This keeps comparisons consistent across inputs that vary by case or port.
 *
 * Responsibilities:
 * - Lowercase and trim host input.
 * - Strip port suffixes from IPv4 and hostname inputs.
 * - Preserve IPv6 bracket notation without the port segment.
 *
 * Non-Goals:
 * - Validating DNS reachability or IP ownership.
 * - Normalizing IDNA or punycode domains.
 *
 * Constraints:
 * - Accepts raw header values, so empty or malformed inputs resolve to an empty string.
 */

/**
 * Purpose:
 * Produce a comparison-safe host token for security gates.
 *
 * Behavior:
 * - Trims whitespace and lowercases the input.
 * - For IPv6 bracket notation, returns the bracketed portion only.
 * - For IPv4 or hostname inputs, strips everything after the first colon.
 *
 * Constraints:
 * - Returns an empty string for empty input or colon-only inputs.
 * - Does not validate DNS or IP syntax beyond minimal parsing.
 *
 * Non-Goals:
 * - Detecting malformed or malicious host headers.
 *
 * @example
 * ```ts
 * normalizeHost('Example.com:443'); // 'example.com'
 * normalizeHost('[::1]:3000'); // '[::1]'
 * ```
 */
export function normalizeHost(host: string): string {
    const lower = host.trim().toLowerCase();

    // Handle empty input
    if (!lower) return '';

    // Handle IPv6 bracket notation: [::1]:3000 -> [::1]
    if (lower.startsWith('[')) {
        const bracketEnd = lower.indexOf(']');
        if (bracketEnd !== -1) {
            return lower.slice(0, bracketEnd + 1);
        }
        return lower;
    }

    // IPv4 or hostname: remove port (everything after first colon)
    const colonIndex = lower.indexOf(':');
    if (colonIndex === -1) return lower;

    // Handle edge cases like ":" or ":8080" where there's no host before colon
    if (colonIndex === 0) return '';

    return lower.slice(0, colonIndex);
}
