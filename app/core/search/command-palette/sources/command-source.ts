import {
    listPaletteCommands,
    registerPaletteCommand,
} from '../registry';
import {
    CORE_PALETTE_CATEGORIES,
    type PaletteCommandHandler,
    type PaletteResource,
    type PaletteSearchSource,
    type RegisteredPaletteCommand,
} from '../types';

/**
 * Command source indexes registered palette commands (core + plugins).
 */
export function createCommandPaletteSource(): PaletteSearchSource {
    return {
        id: 'command',
        label: 'Commands',
        category: CORE_PALETTE_CATEGORIES.find((c) => c.id === 'command')!,
        order: 10,
        async load(context) {
            context.signal?.throwIfAborted();
            return listPaletteCommands().map(commandToResource);
        },
    };
}

export function commandToResource(
    command: RegisteredPaletteCommand
): PaletteResource {
    return {
        key: `command:${command.id}`,
        sourceId: 'command',
        categoryId: 'command',
        recordId: command.id,
        title: command.label,
        subtitle: command.description,
        content: command.description,
        keywords: command.keywords,
        icon: command.icon,
        updatedAt: 0,
        primaryAction: {
            id: `command:run:${command.id}`,
            label: command.label,
            icon: command.icon,
            closeOnSuccess: command.closeOnSuccess,
            target: {
                kind: 'command',
                commandId: command.id,
                expectedPluginGeneration: command.pluginGeneration,
            },
        },
        secondaryActions: [],
        metadata: {
            pluginId: command.pluginId ?? null,
        },
    };
}

export interface CoreCommandSpec {
    id: string;
    label: string;
    description?: string;
    keywords?: readonly string[];
    icon?: string;
    order: number;
    enabled?: boolean;
    closeOnSuccess?: boolean;
    handler: PaletteCommandHandler;
}

/**
 * Register built-in palette commands. Feature-disabled commands are skipped.
 */
export function registerCorePaletteCommands(
    specs: readonly CoreCommandSpec[]
): void {
    for (const spec of specs) {
        if (spec.enabled === false) continue;
        registerPaletteCommand(
            {
                id: spec.id,
                label: spec.label,
                description: spec.description,
                keywords: spec.keywords,
                icon: spec.icon,
                order: spec.order,
                closeOnSuccess: spec.closeOnSuccess,
            },
            spec.handler
        );
    }
}

export function createDefaultCoreCommandSpecs(deps: {
    isFeatureEnabled?: (feature: string) => boolean;
    toggleTheme?: () => Promise<void> | void;
    openDashboard?: () => Promise<void> | void;
    openImageLibrary?: () => Promise<void> | void;
    openThemeSettings?: () => Promise<void> | void;
    openAiSettings?: () => Promise<void> | void;
    newChat?: () => Promise<void> | void;
    newDocument?: () => Promise<void> | void;
    newProject?: () => Promise<void> | void;
}): CoreCommandSpec[] {
    const enabled = deps.isFeatureEnabled ?? (() => true);
    const wrap =
        (fn?: () => Promise<void> | void): PaletteCommandHandler =>
        async () => {
            if (!fn) {
                return {
                    ok: false,
                    error: {
                        code: 'navigation-failed',
                        message: 'Command host handler is unavailable',
                    },
                };
            }
            try {
                await fn();
                return { ok: true };
            } catch (error) {
                return {
                    ok: false,
                    error: {
                        code: 'execution-failed',
                        message:
                            error instanceof Error
                                ? error.message
                                : 'Command failed',
                        cause: error,
                    },
                };
            }
        };

    return [
        {
            id: 'new-chat',
            label: 'New chat',
            description: 'Start a new chat thread',
            icon: 'i-lucide-plus',
            order: 10,
            handler: wrap(deps.newChat),
        },
        {
            id: 'new-document',
            label: 'New document',
            description: 'Create a new document',
            icon: 'i-lucide-file-plus',
            order: 20,
            enabled: enabled('documents'),
            handler: wrap(deps.newDocument),
        },
        {
            id: 'new-project',
            label: 'New project',
            description: 'Create a new project',
            icon: 'i-lucide-folder-plus',
            order: 30,
            handler: wrap(deps.newProject),
        },
        {
            id: 'open-dashboard',
            label: 'Open dashboard',
            description: 'Open the dashboard overlay',
            icon: 'i-lucide-layout-dashboard',
            order: 40,
            enabled: enabled('dashboard'),
            handler: wrap(deps.openDashboard),
        },
        {
            id: 'open-image-library',
            label: 'Open image library',
            description: 'Browse workspace images',
            icon: 'i-lucide-images',
            order: 50,
            enabled: enabled('dashboard'),
            handler: wrap(deps.openImageLibrary),
        },
        {
            id: 'open-theme-settings',
            label: 'Open theme settings',
            description: 'Configure theme appearance',
            keywords: ['theme', 'dark', 'light'],
            icon: 'i-lucide-palette',
            order: 60,
            enabled: enabled('dashboard'),
            handler: wrap(deps.openThemeSettings),
        },
        {
            id: 'open-ai-settings',
            label: 'Open AI settings',
            description: 'Configure AI providers and models',
            keywords: ['ai', 'model', 'openrouter'],
            icon: 'i-lucide-bot',
            order: 70,
            enabled: enabled('dashboard'),
            handler: wrap(deps.openAiSettings),
        },
        {
            id: 'toggle-theme',
            label: 'Toggle light/dark theme',
            description: 'Switch between light and dark mode',
            keywords: ['theme', 'dark', 'light', 'mode'],
            icon: 'i-lucide-sun-moon',
            order: 80,
            handler: wrap(deps.toggleTheme),
        },
    ];
}
