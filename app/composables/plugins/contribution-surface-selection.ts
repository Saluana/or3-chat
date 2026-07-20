import {
    normalizePluginContributionSurfaces,
    type PluginContributionSurfaceId,
} from '~~/shared/plugins/contribution-surfaces';

export interface ContributionSurfaceSelection {
    isSelected(surface: PluginContributionSurfaceId): boolean;
    listSelected(): readonly PluginContributionSurfaceId[];
}

type SelectionGlobals = typeof globalThis & {
    __or3ContributionSurfaceSelection?: ContributionSurfaceSelection;
};

export function createContributionSurfaceSelection(
    configured: readonly string[] | null | undefined
): ContributionSurfaceSelection {
    const selected = normalizePluginContributionSurfaces(configured);
    const selectedSet = new Set<PluginContributionSurfaceId>(selected);
    const selection: ContributionSurfaceSelection = {
        isSelected: (surface: PluginContributionSurfaceId) => selectedSet.has(surface),
        listSelected: () => selected,
    };
    return Object.freeze(selection);
}

/** First startup initialization wins for this browser process/HMR lifetime. */
export function initializeContributionSurfaceSelection(
    configured: readonly string[] | null | undefined
): ContributionSurfaceSelection {
    const globals = globalThis as SelectionGlobals;
    if (!globals.__or3ContributionSurfaceSelection) {
        globals.__or3ContributionSurfaceSelection = createContributionSurfaceSelection(configured);
    }
    return globals.__or3ContributionSurfaceSelection;
}

export function getContributionSurfaceSelection(): ContributionSurfaceSelection {
    return initializeContributionSurfaceSelection([]);
}
