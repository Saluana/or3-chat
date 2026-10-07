import { getContributionSurfaceSelection } from '~/composables/plugins/contribution-surface-selection';
import { shallowRef, markRaw } from 'vue';
import type { ToolCardModule, ToolCardPresentation } from '@or3/plugin-sdk/cards';
import { getPluginGateDecision } from '~/utils/plugins/access-gate';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import {
    createRegistrationHandle,
    type RegistrationHandle
} from '~~/shared/plugins/registration-handle';
import type {
    PackageV2ToolCardDescriptor,
    Sha256
} from '~~/shared/plugins/runtime-descriptor';
export type { ToolCardPresentation } from '@or3/plugin-sdk/cards';
export type ToolCardSource =
    | { readonly kind: 'page'; readonly module: ToolCardModule }
    | { readonly kind: 'unsupported'; readonly code: 'runtime-unsupported' }
    | {
          readonly kind: 'frame';
          readonly pluginId: string;
          readonly packageDigest: Sha256;
          readonly card: PackageV2ToolCardDescriptor;
      };
export interface ToolCardBinding extends ToolCardPresentation {
    readonly tool: string;
    readonly ownerPluginId: string | null;
    readonly source: ToolCardSource;
    readonly available?: () => boolean;
}
const registry = new Map<string, { binding: ToolCardBinding; owner: symbol }>();
const revision = shallowRef(0);
export class ToolCardConflictError extends Error {
    readonly code = 'binding-conflict';
}
export function registerToolCardBinding(input: ToolCardBinding): RegistrationHandle {
    const previous = registry.get(input.tool);
    if (previous && previous.binding.ownerPluginId !== input.ownerPluginId)
        throw new ToolCardConflictError('Another owner already bound this tool');
    if (
        !input.tool ||
        (input.ownerPluginId !== null &&
            useToolRegistry().ownerOf(input.tool) !== input.ownerPluginId)
    )
        throw new ToolCardConflictError(
            'A plugin can bind only its own registered tool'
        );
    if (
        input.source.kind === 'page' &&
        typeof input.source.module?.mount !== 'function'
    )
        throw new TypeError('Card module requires mount');
    if (
        input.minHeight !== undefined &&
        (!Number.isFinite(input.minHeight) ||
            input.minHeight < 48 ||
            input.minHeight > 720)
    )
        throw new TypeError('Card minHeight must be 48–720');
    const binding = markRaw(Object.freeze({ ...input }));
    const owner = Symbol(input.tool);
    registry.set(input.tool, { binding, owner });
    revision.value++;
    return createRegistrationHandle({
        id: input.tool,
        owner,
        isCurrent: () => registry.get(input.tool)?.owner === owner,
        remove() {
            registry.delete(input.tool);
            revision.value++;
        }
    });
}
export function resolveToolCard(tool: string): ToolCardBinding | null {
    void revision.value;
    const binding = registry.get(tool)?.binding;
    if (!binding || binding.available?.() === false || !useToolRegistry().getTool(tool))
        return null;
    if (
        binding.ownerPluginId !== null &&
        (!getContributionSurfaceSelection().isSelected('chat-tool-cards') ||
            useToolRegistry().ownerOf(tool) !== binding.ownerPluginId ||
            !getPluginGateDecision(binding.ownerPluginId).allowed)
    )
        return null;
    return binding;
}

const bindingKeys = new WeakMap<ToolCardBinding, number>();
let bindingSequence = 0;
export function toolCardBindingKey(binding: ToolCardBinding): number {
    let key = bindingKeys.get(binding);
    if (key === undefined) {
        key = ++bindingSequence;
        bindingKeys.set(binding, key);
    }
    return key;
}
