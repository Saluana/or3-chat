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

export function resolveRuntimeLockPageComponent(input: {
    adapterId?: string | null;
    authProviderId?: string | null;
    fallback: Component;
}): Component {
    const explicitId = normalizeAdapterId(input.adapterId);
    const authProviderId = normalizeAdapterId(input.authProviderId);

    if (explicitId && explicitId !== 'default') {
        return resolveLockPageComponent(explicitId, input.fallback);
    }

    if (authProviderId) {
        const providerComponent = resolveLockPageAdapter(authProviderId)?.component;
        if (providerComponent) {
            return providerComponent;
        }
    }

    return resolveLockPageComponent(explicitId || 'default', input.fallback);
}

export function listLockPageAdapters(): LockPageAdapter[] {
    return Array.from(lockPageAdapterRegistry.values());
}
