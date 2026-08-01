import { computed, reactive, type ComputedRef } from 'vue';
import {
    createRegistrationHandle,
    type RegistrationHandle,
} from '~~/shared/plugins/registration-handle';
import { getContributionSurfaceSelection } from '~/composables/plugins/contribution-surface-selection';
import { getContributionSurfaceKernel } from '~/composables/plugins/contribution-surface-kernel';
import {
    getPluginGateDecision,
    isPluginGateDecisionPending,
} from '~/utils/plugins/access-gate';
import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';
import {
    CORE_PALETTE_CATEGORIES,
    type PaletteCategory,
    type PaletteCategoryId,
    type PaletteCommandDefinition,
    type PaletteCommandHandler,
    type PalettePostSourceDefinition,
    type PaletteSearchSource,
    type RegisteredPaletteCommand,
} from './types';
import {
    normalizeAlias,
    validatePaletteCommandDefinition,
    validatePalettePostSourceDefinition,
} from './validation';

export type PaletteRegistryContribution =
    | {
          kind: 'source';
          source: PaletteSearchSource;
      }
    | {
          kind: 'command';
          command: RegisteredPaletteCommand;
      }
    | {
          kind: 'category';
          category: PaletteCategory;
      }
    | {
          kind: 'post-source';
          definition: PalettePostSourceDefinition;
          pluginId: string;
          pluginGeneration?: number;
      };

type OwnedEntry<T> = {
    value: T;
    owner: symbol;
};

type AliasOwner = {
    alias: string;
    categoryId: string;
    ownerId: string;
    owner: symbol;
};

type RegistryState = {
    sources: Map<string, OwnedEntry<PaletteSearchSource>>;
    commands: Map<string, OwnedEntry<RegisteredPaletteCommand>>;
    categories: Map<string, OwnedEntry<PaletteCategory>>;
    aliases: Map<string, AliasOwner>;
    postSourceDefs: Map<string, OwnedEntry<PalettePostSourceDefinition & { pluginId: string; pluginGeneration?: number }>>;
};

const RESERVED_SOURCE_IDS = new Set([
    'command',
    'chat',
    'document',
    'project',
    'image',
    'dashboard',
    'workspace-tab',
]);
const RESERVED_COMMAND_IDS = new Set([
    'new-chat',
    'new-document',
    'new-project',
    'open-dashboard',
    'open-image-library',
    'open-theme-settings',
    'open-ai-settings',
    'toggle-theme',
    'workspace-new-tab',
    'workspace-close-tab',
    'workspace-reopen-tab',
    'workspace-next-tab',
    'workspace-previous-tab',
    'workspace-new-split',
    'workspace-close-split',
]);

function getState(): RegistryState {
    const g = globalThis as {
        __or3PaletteRegistryState?: RegistryState;
    };
    if (!g.__or3PaletteRegistryState) {
        const categories = new Map<string, OwnedEntry<PaletteCategory>>();
        const aliases = new Map<string, AliasOwner>();
        const coreOwner = Symbol('palette-core');
        for (const category of CORE_PALETTE_CATEGORIES) {
            categories.set(category.id, { value: category, owner: coreOwner });
            for (const alias of category.aliases) {
                aliases.set(normalizeAlias(alias), {
                    alias: normalizeAlias(alias),
                    categoryId: category.id,
                    ownerId: `category:${category.id}`,
                    owner: coreOwner,
                });
            }
        }
        g.__or3PaletteRegistryState = {
            sources: new Map(),
            commands: new Map(),
            categories,
            aliases,
            postSourceDefs: new Map(),
        };
    }
    return g.__or3PaletteRegistryState;
}

const reactiveState = reactive({ version: 0 });
const registryListeners = new Set<() => void>();

function bump(): void {
    reactiveState.version += 1;
    for (const listener of [...registryListeners]) {
        try {
            listener();
        } catch {
            // Registry observers are isolated from contribution registration.
        }
    }
}

function useV2Surface(): boolean {
    return getContributionSurfaceSelection().isSelected('command-palette');
}

const v2Kernel = getContributionSurfaceKernel<PaletteRegistryContribution>(
    'command-palette',
    {
        getId: (item) => {
            switch (item.kind) {
                case 'source':
                    return `source:${item.source.id}`;
                case 'command':
                    return `command:${item.command.id}`;
                case 'category':
                    return `category:${item.category.id}`;
                case 'post-source':
                    return `post-source:${item.definition.id}`;
                default: {
                    const _exhaustive: never = item;
                    return String(_exhaustive);
                }
            }
        },
        normalize: (item) => item,
        compare: (left, right) => {
            const leftOrder = contributionOrder(left);
            const rightOrder = contributionOrder(right);
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            return contributionId(left).localeCompare(contributionId(right));
        },
    }
);
const registryGlobals = globalThis as {
    __or3PaletteRegistryBumpUnsubscribe?: () => void;
};
registryGlobals.__or3PaletteRegistryBumpUnsubscribe?.();
registryGlobals.__or3PaletteRegistryBumpUnsubscribe =
    v2Kernel.registry.subscribe(bump);

export function subscribePaletteRegistry(listener: () => void): () => void {
    registryListeners.add(listener);
    return () => registryListeners.delete(listener);
}

function contributionOrder(item: PaletteRegistryContribution): number {
    switch (item.kind) {
        case 'source':
            return item.source.order;
        case 'command':
            return item.command.order ?? 200;
        case 'category':
            return item.category.order;
        case 'post-source':
            return item.definition.order ?? 200;
        default: {
            const _exhaustive: never = item;
            return 999;
        }
    }
}

function contributionId(item: PaletteRegistryContribution): string {
    switch (item.kind) {
        case 'source':
            return item.source.id;
        case 'command':
            return item.command.id;
        case 'category':
            return item.category.id;
        case 'post-source':
            return item.definition.id;
        default: {
            const _exhaustive: never = item;
            return String(_exhaustive);
        }
    }
}

function claimAliases(
    aliases: readonly string[],
    categoryId: string,
    ownerId: string,
    owner: symbol,
    options?: {
        transferOwnership?: boolean;
        allowSharedCategory?: boolean;
    }
): { ok: true } | { ok: false; message: string } {
    const state = getState();
    const normalized = aliases.map(normalizeAlias);
    for (const alias of normalized) {
        const existing = state.aliases.get(alias);
        if (!existing) continue;
        // Core category aliases may be shared by sources in that category.
        // Plugin-owned aliases remain exclusive to their logical owner.
        if (
            existing.categoryId === categoryId &&
            (options?.allowSharedCategory !== false ||
                existing.ownerId === `category:${categoryId}`)
        ) {
            continue;
        }
        if (existing.ownerId !== ownerId) {
            return {
                ok: false,
                message: `alias "${alias}" is already owned by ${existing.ownerId}`,
            };
        }
    }
    for (const alias of normalized) {
        const existing = state.aliases.get(alias);
        if (
            existing?.categoryId === categoryId &&
            (options?.allowSharedCategory !== false ||
                existing.ownerId === `category:${categoryId}`)
        ) {
            const shouldTransfer =
                options?.transferOwnership && existing.ownerId === ownerId;
            if (!shouldTransfer) continue;
        }
        state.aliases.set(alias, {
            alias,
            categoryId,
            ownerId,
            owner,
        });
    }
    return { ok: true };
}

function releaseAliases(ownerId: string, owner: symbol): void {
    const state = getState();
    for (const [alias, entry] of [...state.aliases.entries()]) {
        if (entry.ownerId === ownerId && entry.owner === owner) {
            state.aliases.delete(alias);
        }
    }
}

export function registerPaletteCategory(
    category: PaletteCategory
): RegistrationHandle {
    const state = getState();
    const owner = Symbol(`palette-category:${category.id}`);
    const ownerId = `category:${category.id}`;
    const previous = state.categories.get(category.id);
    const claimed = claimAliases(
        category.aliases,
        category.id,
        ownerId,
        owner,
        { transferOwnership: true }
    );
    if (!claimed.ok) {
        throw new Error(claimed.message);
    }
    if (previous) releaseAliases(ownerId, previous.owner);
    state.categories.set(category.id, { value: category, owner });
    bump();
    return createRegistrationHandle({
        id: category.id,
        owner,
        isCurrent: () => state.categories.get(category.id)?.owner === owner,
        remove: () => {
            if (state.categories.get(category.id)?.owner !== owner) return;
            releaseAliases(ownerId, owner);
            state.categories.delete(category.id);
            bump();
        },
    });
}

export function registerPaletteSource(
    source: PaletteSearchSource
): RegistrationHandle {
    assertContributionIdentity({
        kind: 'source',
        id: source.id,
        pluginId: source.pluginId,
        existingPluginId: findPaletteSourceRaw(source.id)?.pluginId,
    });
    if (useV2Surface()) {
        const previous = findPaletteSourceRaw(source.id);
        const handle = v2Kernel.registry.registerLegacy({
            value: { kind: 'source', source },
        });
        if (previous && previous !== source) previous.dispose?.();
        return {
            id: source.id,
            owner: handle.owner,
            get disposed() {
                return handle.disposed;
            },
            dispose() {
                const removed = handle.dispose();
                if (removed) source.dispose?.();
                return removed;
            },
        };
    }
    const state = getState();
    const owner = Symbol(`palette-source:${source.id}`);
    const ownerId = `source:${source.id}`;
    const previous = state.sources.get(source.id);
    const claimed = claimAliases(
        source.category.aliases,
        source.category.id,
        ownerId,
        owner,
        { transferOwnership: true }
    );
    if (!claimed.ok) {
        throw new Error(claimed.message);
    }
    if (previous) releaseAliases(ownerId, previous.owner);
    const categoryOwner = state.categories.get(source.category.id)?.owner;
    if (!categoryOwner || categoryOwner === previous?.owner) {
        state.categories.set(source.category.id, {
            value: source.category,
            owner,
        });
    }
    previous?.value.dispose?.();
    state.sources.set(source.id, { value: source, owner });
    bump();
    return createRegistrationHandle({
        id: source.id,
        owner,
        isCurrent: () => state.sources.get(source.id)?.owner === owner,
        remove: () => {
            if (state.sources.get(source.id)?.owner !== owner) return;
            releaseAliases(ownerId, owner);
            state.sources.delete(source.id);
            if (state.categories.get(source.category.id)?.owner === owner) {
                state.categories.delete(source.category.id);
            }
            source.dispose?.();
            bump();
        },
    });
}

export function registerPaletteCommand(
    definition: PaletteCommandDefinition,
    handler: PaletteCommandHandler,
    options?: {
        pluginId?: string;
        pluginGeneration?: number;
        access?: PluginGatePolicy;
    }
): RegistrationHandle {
    const validated = validatePaletteCommandDefinition(definition);
    if (!validated.ok) throw new Error(validated.message);

    const command: RegisteredPaletteCommand = {
        ...definition,
        access: options?.access ?? definition.access,
        pluginId: options?.pluginId,
        pluginGeneration: options?.pluginGeneration,
        handler,
    };
    assertContributionIdentity({
        kind: 'command',
        id: definition.id,
        pluginId: options?.pluginId,
        existingPluginId: findPaletteCommandRaw(definition.id)?.pluginId,
    });

    if (useV2Surface()) {
        return v2Kernel.registry.registerLegacy({
            value: { kind: 'command', command },
        });
    }

    const state = getState();
    const owner = Symbol(`palette-command:${definition.id}`);
    state.commands.set(definition.id, { value: command, owner });
    bump();
    return createRegistrationHandle({
        id: definition.id,
        owner,
        isCurrent: () => state.commands.get(definition.id)?.owner === owner,
        remove: () => {
            if (state.commands.get(definition.id)?.owner !== owner) return;
            state.commands.delete(definition.id);
            bump();
        },
    });
}

export function registerPalettePostSourceDefinition(
    definition: PalettePostSourceDefinition,
    options: { pluginId: string; pluginGeneration?: number }
): RegistrationHandle {
    const validated = validatePalettePostSourceDefinition(definition);
    if (!validated.ok) throw new Error(validated.message);

    const state = getState();
    const previous = state.postSourceDefs.get(definition.id);
    assertContributionIdentity({
        kind: 'post-source',
        id: definition.id,
        pluginId: options.pluginId,
        existingPluginId: previous?.value.pluginId,
    });
    const owner = Symbol(`palette-post-source:${definition.id}`);
    const ownerId = `post-source:${options.pluginId}:${definition.id}`;
    const claimed = claimAliases(
        definition.filterAliases,
        definition.categoryId,
        ownerId,
        owner,
        { transferOwnership: true, allowSharedCategory: false }
    );
    if (!claimed.ok) {
        // Leave current alias owner unchanged on conflict.
        throw new Error(claimed.message);
    }

    if (previous) releaseAliases(ownerId, previous.owner);
    const categoryOwner = state.categories.get(definition.categoryId)?.owner;
    if (!categoryOwner || categoryOwner === previous?.owner) {
        state.categories.set(definition.categoryId, {
            value: {
                id: definition.categoryId as PaletteCategoryId,
                label: definition.label,
                aliases: definition.filterAliases.map(normalizeAlias),
                icon: definition.icon,
                order: definition.order ?? 200,
            },
            owner,
        });
    }

    const value = {
        ...definition,
        pluginId: options.pluginId,
        pluginGeneration: options.pluginGeneration,
    };
    state.postSourceDefs.set(definition.id, { value, owner });
    bump();

    const legacyHandle = createRegistrationHandle({
        id: definition.id,
        owner,
        isCurrent: () => state.postSourceDefs.get(definition.id)?.owner === owner,
        remove: () => {
            if (state.postSourceDefs.get(definition.id)?.owner !== owner) return;
            releaseAliases(ownerId, owner);
            state.postSourceDefs.delete(definition.id);
            if (state.categories.get(definition.categoryId)?.owner === owner) {
                state.categories.delete(definition.categoryId);
            }
            bump();
        },
    });

    if (useV2Surface()) {
        const v2Handle = v2Kernel.registry.registerLegacy({
            value: {
                kind: 'post-source',
                definition,
                pluginId: options.pluginId,
                pluginGeneration: options.pluginGeneration,
            },
        });
        return {
            id: definition.id,
            owner,
            get disposed() {
                return legacyHandle.disposed && v2Handle.disposed;
            },
            dispose() {
                const removedV2 = v2Handle.dispose();
                const removedLegacy = legacyHandle.dispose();
                return removedV2 || removedLegacy;
            },
        };
    }

    return legacyHandle;
}

export function getPaletteAliasMap(): Map<string, string> {
    const state = getState();
    // Access reactive version for Vue consumers.
    void reactiveState.version;
    const map = new Map<string, string>();
    for (const [alias, entry] of state.aliases) {
        const inaccessibleOwner = [...state.postSourceDefs.values()].some(
            ({ value }) =>
                entry.ownerId ===
                    `post-source:${value.pluginId}:${value.id}` &&
                Boolean(
                    value.access &&
                        !getPluginGateDecision(value.pluginId, value.access)
                            .allowed
                )
        );
        if (inaccessibleOwner) continue;
        map.set(alias, entry.categoryId);
    }
    return map;
}

export function listPaletteSources(): PaletteSearchSource[] {
    void reactiveState.version;
    return listPaletteSourcesRaw().filter(isPaletteSourceAccessible);
}

function listPaletteSourcesRaw(): PaletteSearchSource[] {
    if (useV2Surface()) {
        return v2Kernel.items.value
            .filter(
                (item): item is Extract<PaletteRegistryContribution, { kind: 'source' }> =>
                    item.kind === 'source'
            )
            .map((item) => item.source)
            .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }
    return Array.from(getState().sources.values())
        .map((entry) => entry.value)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function listPaletteCommands(): RegisteredPaletteCommand[] {
    void reactiveState.version;
    return listPaletteCommandsRaw().filter(isPaletteCommandAccessible);
}

function listPaletteCommandsRaw(): RegisteredPaletteCommand[] {
    if (useV2Surface()) {
        return v2Kernel.items.value
            .filter(
                (item): item is Extract<PaletteRegistryContribution, { kind: 'command' }> =>
                    item.kind === 'command'
            )
            .map((item) => item.command)
            .sort(
                (a, b) =>
                    (a.order ?? 200) - (b.order ?? 200) || a.id.localeCompare(b.id)
            );
    }
    return Array.from(getState().commands.values())
        .map((entry) => entry.value)
        .sort(
            (a, b) =>
                (a.order ?? 200) - (b.order ?? 200) || a.id.localeCompare(b.id)
        );
}

export function listPaletteCategories(): PaletteCategory[] {
    void reactiveState.version;
    const byId = new Map(
        Array.from(getState().categories.values(), (entry) => [
            entry.value.id,
            entry.value,
        ])
    );
    if (useV2Surface()) {
        for (const item of v2Kernel.items.value) {
            if (item.kind === 'category') byId.set(item.category.id, item.category);
            if (item.kind === 'source') {
                byId.set(item.source.category.id, item.source.category);
            }
        }
    }
    const visibleCategoryIds = new Set(
        listPaletteSources().map((source) => source.category.id)
    );
    if (listPaletteSources().some((source) => source.id === 'dashboard')) {
        visibleCategoryIds.add('setting');
    }
    if (listPaletteCommands().length) visibleCategoryIds.add('command');
    return [...byId.values()]
        .filter((category) => visibleCategoryIds.has(category.id))
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function listPalettePostSourceDefinitions(): Array<
    PalettePostSourceDefinition & { pluginId: string; pluginGeneration?: number }
> {
    void reactiveState.version;
    if (useV2Surface()) {
        return v2Kernel.items.value
            .filter(
                (
                    item
                ): item is Extract<
                    PaletteRegistryContribution,
                    { kind: 'post-source' }
                > => item.kind === 'post-source'
            )
            .map((item) => ({
                ...item.definition,
                pluginId: item.pluginId,
                pluginGeneration: item.pluginGeneration,
            }));
    }
    return Array.from(getState().postSourceDefs.values()).map((entry) => entry.value);
}

export function getPaletteCommand(
    commandId: string,
    options?: { includeInaccessible?: boolean }
): RegisteredPaletteCommand | undefined {
    void reactiveState.version;
    const command = findPaletteCommandRaw(commandId);
    if (!command) return undefined;
    if (!options?.includeInaccessible && !isPaletteCommandAccessible(command)) {
        return undefined;
    }
    return command;
}

export function getPaletteSource(
    sourceId: string,
    options?: { includeInaccessible?: boolean }
): PaletteSearchSource | undefined {
    void reactiveState.version;
    const source = findPaletteSourceRaw(sourceId);
    if (!source) return undefined;
    if (!options?.includeInaccessible && !isPaletteSourceAccessible(source)) {
        return undefined;
    }
    return source;
}

export function useCommandPaletteRegistry(): {
    sources: ComputedRef<PaletteSearchSource[]>;
    commands: ComputedRef<RegisteredPaletteCommand[]>;
    categories: ComputedRef<PaletteCategory[]>;
    aliasMap: ComputedRef<Map<string, string>>;
    postSources: ComputedRef<
        Array<
            PalettePostSourceDefinition & {
                pluginId: string;
                pluginGeneration?: number;
            }
        >
    >;
    registerSource: typeof registerPaletteSource;
    registerCommand: typeof registerPaletteCommand;
    registerCategory: typeof registerPaletteCategory;
    registerPostSourceDefinition: typeof registerPalettePostSourceDefinition;
} {
    return {
        sources: computed(() => listPaletteSources()),
        commands: computed(() => listPaletteCommands()),
        categories: computed(() => listPaletteCategories()),
        aliasMap: computed(() => getPaletteAliasMap()),
        postSources: computed(() => listPalettePostSourceDefinitions()),
        registerSource: registerPaletteSource,
        registerCommand: registerPaletteCommand,
        registerCategory: registerPaletteCategory,
        registerPostSourceDefinition: registerPalettePostSourceDefinition,
    };
}

/** Test helper: clear non-core registrations. */
export function __resetPaletteRegistryForTests(): void {
    const g = globalThis as { __or3PaletteRegistryState?: RegistryState };
    delete g.__or3PaletteRegistryState;
    v2Kernel.registry.unregisterLegacyBatch(v2Kernel.registry.listLegacyIds());
    registryListeners.clear();
    reactiveState.version = 0;
}

function isPaletteSourceAccessible(source: PaletteSearchSource): boolean {
    if (!source.access) return true;
    const decision = getPluginGateDecision(source.pluginId, source.access);
    return decision.allowed && !isPluginGateDecisionPending(source.pluginId);
}

function isPaletteCommandAccessible(command: RegisteredPaletteCommand): boolean {
    if (!command.access) return true;
    const decision = getPluginGateDecision(command.pluginId, command.access);
    return decision.allowed && !isPluginGateDecisionPending(command.pluginId);
}

function findPaletteSourceRaw(sourceId: string): PaletteSearchSource | undefined {
    if (useV2Surface()) {
        return v2Kernel.items.value.find(
            (
                item
            ): item is Extract<
                PaletteRegistryContribution,
                { kind: 'source' }
            > => item.kind === 'source' && item.source.id === sourceId
        )?.source;
    }
    return getState().sources.get(sourceId)?.value;
}

function findPaletteCommandRaw(
    commandId: string
): RegisteredPaletteCommand | undefined {
    if (useV2Surface()) {
        return v2Kernel.items.value.find(
            (
                item
            ): item is Extract<
                PaletteRegistryContribution,
                { kind: 'command' }
            > => item.kind === 'command' && item.command.id === commandId
        )?.command;
    }
    return getState().commands.get(commandId)?.value;
}

function assertContributionIdentity(options: {
    kind: 'source' | 'command' | 'post-source';
    id: string;
    pluginId?: string;
    existingPluginId?: string;
}): void {
    const { kind, id, pluginId, existingPluginId } = options;
    if (pluginId) {
        const reserved =
            kind === 'command'
                ? RESERVED_COMMAND_IDS.has(id)
                : RESERVED_SOURCE_IDS.has(id);
        if (reserved) {
            throw new Error(
                `${kind} id "${id}" is reserved for the OR3 host`
            );
        }
    }
    const incomingOwner = pluginId ?? '__core__';
    const currentOwner = existingPluginId ?? '__core__';
    if (
        options.existingPluginId !== undefined ||
        (kind !== 'post-source' &&
            (kind === 'source'
                ? Boolean(findPaletteSourceRaw(id))
                : Boolean(findPaletteCommandRaw(id))))
    ) {
        if (incomingOwner !== currentOwner) {
            throw new Error(
                `${kind} id "${id}" is already owned by ${
                    existingPluginId ?? 'the OR3 host'
                }`
            );
        }
    }
}
