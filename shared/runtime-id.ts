/**
 * Generate a UUID v4 in browsers, workers, and server runtimes.
 *
 * `Crypto.randomUUID()` is unavailable in older browsers and in insecure
 * browser contexts. Prefer it when present, fall back to `getRandomValues()`,
 * and preserve UUID shape with a non-cryptographic last resort.
 *
 * These IDs are for record identity and deduplication, not authentication
 * tokens or other security-sensitive secrets.
 */
export function createRuntimeUuid(): string {
    const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
    if (typeof cryptoApi?.randomUUID === 'function') {
        return cryptoApi.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (typeof cryptoApi?.getRandomValues === 'function') {
        cryptoApi.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index++) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }

    // RFC 4122 version 4 + variant bits.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, '0')
    );
    return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join(''),
    ].join('-');
}
