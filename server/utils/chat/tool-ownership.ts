import { ActivationTable } from '~~/shared/plugins/activation-table';
import { ContributionRegistry } from '~~/shared/plugins/contribution-registry';
import type { RegisteredServerTool } from './tool-registry';

const registry = new ContributionRegistry<RegisteredServerTool>({
    activationTable: new ActivationTable(),
    getId: (tool) => tool.definition.function.name,
});

export function recordServerToolOwnership(
    tool: RegisteredServerTool,
    owner: symbol
): void {
    registry.registerLegacy({ value: tool, owner });
}

export function removeServerToolOwner(owner: symbol): void {
    registry.removeOwner(owner);
}

export function removeServerToolOwnership(name: string): void {
    registry.unregisterLegacy(name);
}

export function inspectServerToolOwnership() {
    return registry.inspect();
}
