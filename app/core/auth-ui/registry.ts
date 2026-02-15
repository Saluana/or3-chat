import { markRaw, reactive } from 'vue';
import type { Component } from 'vue';

export interface AuthUiAdapter {
    id: string;
    component: Component;
}

const authUiAdapterRegistry = reactive(new Map<string, AuthUiAdapter>());

function normalizeAdapterId(value: string): string {
    return value.trim().toLowerCase();
}

export function registerAuthUiAdapter(input: AuthUiAdapter): void {
    const id = normalizeAdapterId(input.id);
    if (!id) return;
    authUiAdapterRegistry.set(id, {
        id,
        component: markRaw(input.component),
    });
}

export function unregisterAuthUiAdapter(id: string): void {
    authUiAdapterRegistry.delete(normalizeAdapterId(id));
}

export function resolveAuthUiAdapter(id: string): AuthUiAdapter | null {
    return authUiAdapterRegistry.get(normalizeAdapterId(id)) ?? null;
}

export function listAuthUiAdapters(): AuthUiAdapter[] {
    return Array.from(authUiAdapterRegistry.values());
}
