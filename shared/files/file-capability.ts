/**
 * Capability advertised by clients that understand the generic `file` kind.
 *
 * The capability is intentionally a small version marker rather than an
 * allowlist. The server uses it only when a generic file record is about to
 * cross the sync or storage boundary, preserving legacy image/PDF traffic.
 */
export const FILE_KIND_CAPABILITY = 'v1' as const;
export type FileKindCapability = typeof FILE_KIND_CAPABILITY;
