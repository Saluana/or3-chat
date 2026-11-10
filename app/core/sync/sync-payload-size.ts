/** Check the UTF-8 size without encoding when UTF-16 length settles the result. */
export function isSyncPayloadTooLarge(serialized: string | undefined, limit: number): boolean {
    const length = serialized?.length ?? 0;
    if (length > limit) return true;
    if (3 * length <= limit) return false;
    return new TextEncoder().encode(serialized).byteLength > limit;
}
