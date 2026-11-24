import { useState } from 'nuxt/app';
import { z } from 'zod';
import { ref } from 'vue';
import type { SessionPayload } from './useSessionContext';

export const OFFLINE_WORKSPACE_KEY = 'or3:offline-workspace:v1';
export const OFFLINE_WORKSPACE_OWNER_PREFIX = `${OFFLINE_WORKSPACE_KEY}:owner:`;

const workspaceSchema = z.object({
    userId: z.string().min(1),
    workspaceId: z.string().min(1),
    workspaceName: z.string(),
    role: z.enum(['owner', 'editor', 'viewer']),
    workspaceItemCapability: z.literal('v1').optional(),
    explorerCapability: z.literal('v1').optional(),
});

export type OfflineWorkspace = z.infer<typeof workspaceSchema>;

export function useOfflineWorkspace() {
    return import.meta.client ? useState<OfflineWorkspace | null>('offline-workspace', () => null) : ref(null);
}

export function getOfflineWorkspace(): OfflineWorkspace | null {
    try {
        return useOfflineWorkspace().value;
    } catch {
        return null;
    }
}

export function readOfflineWorkspaceRecord(): string | null {
    try {
        return localStorage.getItem(OFFLINE_WORKSPACE_KEY);
    } catch {
        return null;
    }
}

export function parseOfflineWorkspace(raw: string | null): OfflineWorkspace | null {
    if (!raw) return null;
    try {
        const parsed = workspaceSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

export function invalidateOfflineWorkspace(): void {
    try {
        // A different value fences checks that were already in flight in other tabs.
        localStorage.setItem(OFFLINE_WORKSPACE_KEY, JSON.stringify({ cleared: crypto.randomUUID() }));
    } catch {
        // Storage may be unavailable. The active tab still drops local access.
    }
}

export function rememberOfflineWorkspace(payload: SessionPayload, previousRecord: string | null): void {
    if (previousRecord !== readOfflineWorkspaceRecord()) return;
    const { session } = payload;
    const workspace = payload.offlineWorkspaceAccess && payload.appAccessAllowed && session?.authenticated
        ? workspaceSchema.safeParse({
              userId: session.user?.id,
              workspaceId: session.workspace?.id,
              workspaceName: session.workspace?.name,
              role: session.role,
              workspaceItemCapability: payload.workspaceItemCapability,
              explorerCapability: payload.explorerCapability,
          })
        : null;
    if (!workspace?.success) {
        if (parseOfflineWorkspace(previousRecord)) invalidateOfflineWorkspace();
        return;
    }

    const raw = JSON.stringify(workspace.data);
    if (raw === previousRecord) return;
    try {
        localStorage.setItem(OFFLINE_WORKSPACE_KEY, raw);
    } catch {
        // Offline access requires a successfully stored scope.
    }
}

function workspaceOwnerKey(workspaceId: string): string {
    return `${OFFLINE_WORKSPACE_OWNER_PREFIX}${workspaceId}`;
}

/** A shared workspace can have pending local changes from only one offline owner. */
export function canUseOfflineWorkspaceDb(workspaceId: string, userId: string | undefined): boolean {
    if (!import.meta.client) return true;
    try {
        const owner = localStorage.getItem(workspaceOwnerKey(workspaceId));
        return owner === null || owner === userId;
    } catch {
        return true;
    }
}

export function bindOfflineWorkspaceDb(workspace: OfflineWorkspace): boolean {
    const { workspaceId, userId } = workspace;
    if (!canUseOfflineWorkspaceDb(workspaceId, userId)) return false;
    try {
        if (workspace.role !== 'viewer') localStorage.setItem(workspaceOwnerKey(workspaceId), userId);
        return true;
    } catch {
        return false;
    }
}

export function releaseOfflineWorkspaceDb(workspaceId: string, userId: string): void {
    try {
        const key = workspaceOwnerKey(workspaceId);
        if (localStorage.getItem(key) === userId) localStorage.removeItem(key);
    } catch {
        // Keep the original owner when storage is unavailable.
    }
}

export function ownsOfflineWorkspaceDb(workspaceId: string, userId: string): boolean {
    try {
        return localStorage.getItem(workspaceOwnerKey(workspaceId)) === userId;
    } catch {
        return false;
    }
}
