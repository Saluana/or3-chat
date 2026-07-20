import {
    normalizePluginContributionSurfaces,
    type PluginContributionSurfaceId,
} from '~~/shared/plugins/contribution-surfaces';

export interface ServerContributionSurfaceSelection {
    isSelected(surface: PluginContributionSurfaceId): boolean;
    listSelected(): readonly PluginContributionSurfaceId[];
}

type ServerSelectionGlobals = typeof globalThis & {
    __or3ServerContributionSurfaceSelection?: ServerContributionSurfaceSelection;
};

export function createServerContributionSurfaceSelection(
    configured: readonly string[] | null | undefined
): ServerContributionSurfaceSelection {
    const selected = normalizePluginContributionSurfaces(configured);
    const selectedSet = new Set<PluginContributionSurfaceId>(selected);
    return Object.freeze({
        isSelected: (surface: PluginContributionSurfaceId) =>
            selectedSet.has(surface),
        listSelected: () => selected,
    });
}

export function initializeServerContributionSurfaceSelection(
    configured: readonly string[] | null | undefined
): ServerContributionSurfaceSelection {
    const globals = globalThis as ServerSelectionGlobals;
    if (!globals.__or3ServerContributionSurfaceSelection) {
        globals.__or3ServerContributionSurfaceSelection =
            createServerContributionSurfaceSelection(configured);
    }
    return globals.__or3ServerContributionSurfaceSelection;
}

export function getServerContributionSurfaceSelection(): ServerContributionSurfaceSelection {
    const configured = process.env.OR3_PLUGIN_CONTRIBUTION_V2_SURFACES?.split(
        ','
    );
    return initializeServerContributionSurfaceSelection(configured ?? []);
}
