// Stub for Nuxt auto-imports in Vitest context
export function useToast() {
    return { add: () => {} };
}

export function useRuntimeConfig(_event?: unknown): any {
    throw new Error('useRuntimeConfig must be mocked in tests');
}
