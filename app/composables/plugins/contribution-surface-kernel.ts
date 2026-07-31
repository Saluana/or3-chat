import { shallowRef, type ShallowRef } from 'vue';
import { ActivationTable } from '~~/shared/plugins/activation-table';
import {
    ContributionRegistry,
    type ContributionRegistryOptions,
} from '~~/shared/plugins/contribution-registry';
import type { PluginContributionSurfaceId } from '~~/shared/plugins/contribution-surfaces';

export interface VueContributionSurfaceKernel<T> {
    readonly registry: ContributionRegistry<T, void>;
    readonly items: ShallowRef<readonly T[]>;
}

type KernelGlobals = typeof globalThis & {
    __or3PluginActivationTable?: ActivationTable;
    __or3ContributionSurfaceKernels?: Map<
        string,
        VueContributionSurfaceKernel<unknown>
    >;
};

export function getPluginContributionActivationTable(): ActivationTable {
    const globals = globalThis as KernelGlobals;
    return (
        globals.__or3PluginActivationTable ??
        (globals.__or3PluginActivationTable = new ActivationTable())
    );
}

export function getContributionSurfaceKernel<T>(
    surface: PluginContributionSurfaceId,
    options: Omit<ContributionRegistryOptions<T, void, Readonly<Record<string, unknown>>>, 'activationTable'>,
    channel = 'default'
): VueContributionSurfaceKernel<T> {
    const globals = globalThis as KernelGlobals;
    const kernels =
        globals.__or3ContributionSurfaceKernels ??
        (globals.__or3ContributionSurfaceKernels = new Map());
    const kernelKey = channel === 'default' ? surface : `${surface}:${channel}`;
    const existing = kernels.get(kernelKey) as VueContributionSurfaceKernel<T> | undefined;
    if (existing) return existing;

    const registry = new ContributionRegistry<T, void>({
        ...options,
        activationTable: getPluginContributionActivationTable(),
    });
    const items = shallowRef<readonly T[]>(registry.snapshot(undefined));
    registry.subscribe(() => {
        items.value = registry.snapshot(undefined);
    });
    const kernel = Object.freeze({ registry, items });
    kernels.set(kernelKey, kernel as VueContributionSurfaceKernel<unknown>);
    return kernel;
}
