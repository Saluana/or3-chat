export interface TrustedModelContribution {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
}

/**
 * Host-neutral model list. Workflow execution binds this to `or3-workflow-core`
 * inside the workflows plugin. Core does not import that package.
 */
const models = new Map<string, TrustedModelContribution>();
const owners = new Map<string, symbol>();

export function registerTrustedExecutionModel(
    input: TrustedModelContribution
): { dispose(): void } {
    const owner = Symbol(input.id);
    models.set(input.id, { ...input });
    owners.set(input.id, owner);
    return {
        dispose() {
            if (owners.get(input.id) !== owner) return;
            owners.delete(input.id);
            models.delete(input.id);
        },
    };
}

export function readTrustedExecutionModel(id: string): TrustedModelContribution | undefined {
    return models.get(id);
}
