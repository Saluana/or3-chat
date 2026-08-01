import type { WorkspaceResource, WorkspaceTab } from './types';

const MAX_RESOURCE_ID_LENGTH = 512;

function validId(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.trim().length > 0 &&
        value.length <= MAX_RESOURCE_ID_LENGTH
    );
}

function encode(value: string): string {
    return encodeURIComponent(value.trim());
}

/** Returns a canonical resource key, or null when a descriptor is malformed. */
export function getCanonicalResourceKey(
    resource: WorkspaceResource,
    blankTabId?: string
): string | null {
    if (resource.kind === 'chat') {
        if (resource.threadId === null) {
            return validId(blankTabId) ? `blank-chat:${encode(blankTabId)}` : null;
        }
        return validId(resource.threadId) ? `chat:${encode(resource.threadId)}` : null;
    }

    if (resource.kind === 'document') {
        return validId(resource.documentId)
            ? `document:${encode(resource.documentId)}`
            : null;
    }

    if (!validId(resource.appId)) return null;
    if (validId(resource.recordId)) {
        return `app:${encode(resource.appId)}:${encode(resource.recordId)}`;
    }
    if (validId(resource.instanceKey)) {
        return `app:${encode(resource.appId)}:instance:${encode(resource.instanceKey)}`;
    }
    return null;
}

/**
 * A duplicate uses an instance key without changing the underlying resource.
 * The stable tab ID keeps two duplicate views independently addressable.
 */
export function getResourceKey(
    resource: WorkspaceResource,
    tabId: string,
    allowDuplicate = false
): string | null {
    const canonical = getCanonicalResourceKey(resource, tabId);
    if (!canonical) return null;
    return allowDuplicate ? `${canonical}:instance:${encode(tabId)}` : canonical;
}

export function getTabResourceKey(tab: WorkspaceTab): string | null {
    return getCanonicalResourceKey(tab.resource, tab.id);
}

export function isValidWorkspaceResource(resource: unknown): resource is WorkspaceResource {
    if (resource === null || typeof resource !== 'object') return false;
    const candidate = resource as Partial<WorkspaceResource>;
    if (candidate.kind === 'chat') {
        return candidate.threadId === null || validId(candidate.threadId);
    }
    if (candidate.kind === 'document') return validId(candidate.documentId);
    if (candidate.kind === 'app') {
        return (
            validId(candidate.appId) &&
            (validId(candidate.recordId) || validId(candidate.instanceKey))
        );
    }
    return false;
}
