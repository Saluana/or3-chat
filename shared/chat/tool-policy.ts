function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, canonicalize(child)])
    );
}

export function toolDefinitionEquals(left: unknown, right: unknown): boolean {
    const providerVisible = (value: unknown): unknown => {
        if (!value || typeof value !== 'object') return value;
        const definition = value as Record<string, unknown>;
        return { type: definition.type, function: definition.function };
    };
    return JSON.stringify(canonicalize(providerVisible(left))) === JSON.stringify(canonicalize(providerVisible(right)));
}

export function snapshotToolDefinitions<T>(definitions: T[] | undefined): T[] | undefined {
    if (!definitions?.length) return undefined;
    return structuredClone(definitions);
}
