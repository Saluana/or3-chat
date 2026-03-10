import { markRaw, reactive } from 'vue';
import type { Component } from 'vue';

export interface LockPageAdapter {
    id: string;
    component: Component;
}

const lockPageAdapterRegistry = reactive(new Map<string, LockPageAdapter>());

function normalizeAdapterId(value: string | null | undefined): string {
    return String(value ?? '')
        .trim()
        .toLowerCase();
}

export function registerLockPageAdapter(input: LockPageAdapter): void {
    const id = normalizeAdapterId(input.id);
    if (!id) return;
    lockPageAdapterRegistry.set(id, {
        id,
        component: markRaw(input.component),
    });
}

export function unregisterLockPageAdapter(id: string): void {
    lockPageAdapterRegistry.delete(normalizeAdapterId(id));
}

export function resolveLockPageAdapter(id: string | null | undefined): LockPageAdapter | null {
    const normalizedId = normalizeAdapterId(id);
    if (!normalizedId) return null;
    return lockPageAdapterRegistry.get(normalizedId) ?? null;
}

export function resolveLockPageComponent(
    id: string | null | undefined,
    fallback: Component
): Component {
    return resolveLockPageAdapter(id)?.component ?? fallback;
}

export function listLockPageAdapters(): LockPageAdapter[] {
    return Array.from(lockPageAdapterRegistry.values());
}
