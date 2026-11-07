/** Optional operator policy. Local work and explicit recovery do not require Cloud. */
export interface CloudAccess {
    enabled: boolean;
    /** Milliseconds since epoch; clients must stop transport even while offline. */
    expiresAt: number;
}

export function cloudAccessAllowed(access: CloudAccess | undefined, required = false, now = Date.now()): boolean {
    return access ? access.enabled && access.expiresAt > now : !required;
}
