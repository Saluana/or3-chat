import { defineAsyncComponent, type Component } from 'vue';
import {
    APP_THEME_COMPONENT_KEYS,
    type AppThemeComponent,
} from './types';

type ThemeComponentLoader = () => Promise<Component>;

function isComponentLike(value: unknown): value is Component {
    return (
        value !== null &&
        (typeof value === 'function' || typeof value === 'object')
    );
}

function requireComponent(value: unknown, source: string): Component {
    if (!isComponentLike(value)) {
        throw new TypeError(`[theme] Invalid component export from ${source}`);
    }

    return value;
}

function defineAsyncVueComponent(
    loader: () => Promise<{ default: unknown }>
): Component {
    return defineAsyncComponent(async () => {
        const module = await loader();
        return requireComponent(module.default, 'async Vue module');
    });
}

const themeVueModules = import.meta.glob('../*/**/*.vue', {
    import: 'default',
}) as Record<string, ThemeComponentLoader>;

const asyncChunkCache = new Map<
    string,
    { moduleKey: string; component: Component }
>();

const DashboardModalDefault = defineAsyncVueComponent(
    () => import('~/components/dashboard/Dashboard.vue')
);

const SystemPromptsModalDefault = defineAsyncVueComponent(
    () => import('~/components/chat/SystemPromptsModal.vue')
);

const ModelCatalogModalDefault = defineAsyncVueComponent(
    () => import('~/components/modal/ModelCatalog.vue')
);

const DocumentEditorDefault = defineAsyncVueComponent(
    () => import('~/components/documents/DocumentEditor.vue')
);

const SidebarDefault = defineAsyncVueComponent(
    () => import('~/components/sidebar/SideBar.vue')
);
const SidebarCollapsedDefault = defineAsyncVueComponent(
    () => import('~/components/sidebar/SideNavContentCollapsed.vue')
);
const ChatPageDefault = defineAsyncVueComponent(
    () => import('~/components/chat/ChatContainer.vue')
);
const ChatMessageDefault = defineAsyncVueComponent(
    () => import('~/components/chat/ChatMessage.vue')
);
const ChatInputDefault = defineAsyncVueComponent(
    () => import('~/components/chat/ChatInputDropper.vue')
);
const ModelSelectorDefault = defineAsyncVueComponent(
    () => import('~/components/chat/ModelSelect.vue')
);
const SidebarAuthButtonDefault = defineAsyncVueComponent(
    () => import('~/components/sidebar/SidebarAuthButton.vue')
);
const DocumentationShellDefault = defineAsyncVueComponent(
    () => import('~/components/DocumentationShell.vue')
);
const WorkflowStatusDefault = defineAsyncVueComponent(
    () => import('~/components/chat/WorkflowExecutionStatus.vue')
);

export const CORE_APP_COMPONENT_DEFAULTS: Record<AppThemeComponent, Component> =
    {
        sidebar: SidebarDefault,
        'sidebar-collapsed': SidebarCollapsedDefault,
        'chat-page': ChatPageDefault,
        'chat-message': ChatMessageDefault,
        'chat-input': ChatInputDefault,
        'document-editor': DocumentEditorDefault,
        'dashboard-modal': DashboardModalDefault,
        'model-selector': ModelSelectorDefault,
        'system-prompts-modal': SystemPromptsModalDefault,
        'model-catalog-modal': ModelCatalogModalDefault,
        'sidebar-auth-button': SidebarAuthButtonDefault,
        'documentation-shell': DocumentationShellDefault,
        'workflow-status': WorkflowStatusDefault,
    };

const shouldWarnThemeComponentFallback =
    import.meta.dev || import.meta.env.MODE === 'test';

function warnThemeComponentFallback(
    themeDirName: string,
    key: AppThemeComponent,
    componentPath: string
) {
    if (!shouldWarnThemeComponentFallback) {
        return;
    }

    console.warn(
        `[theme] Missing custom component "${componentPath}" for "${key}" in theme "${themeDirName}". Using default component.`
    );
}

function resolveThemeComponentModuleKey(
    themeDirName: string,
    componentPath: string
): string | null {
    const trimmedPath = componentPath.trim();
    if (!trimmedPath) {
        return null;
    }

    const relativePath = trimmedPath.replace(/^\.?\//, '');
    if (
        !relativePath ||
        relativePath === '..' ||
        relativePath.startsWith('../') ||
        relativePath.includes('/../')
    ) {
        return null;
    }

    return `../${themeDirName}/${relativePath}`;
}

function getMemoizedAsyncThemeComponent(
    cacheKey: string,
    moduleKey: string,
    loader: ThemeComponentLoader
): Component {
    const cached = asyncChunkCache.get(cacheKey);
    if (cached?.moduleKey === moduleKey) {
        return cached.component;
    }

    const component = defineAsyncComponent(loader);
    asyncChunkCache.set(cacheKey, { moduleKey, component });
    return component;
}

export function createThemeComponentMap(
    themeDirName: string,
    customConfig?: Partial<Record<AppThemeComponent, string>>,
    defaults: Record<AppThemeComponent, Component> = CORE_APP_COMPONENT_DEFAULTS
): Record<AppThemeComponent, Component> {
    const componentMap = {
        ...defaults,
    } as Record<AppThemeComponent, Component>;

    if (!customConfig) {
        return componentMap;
    }

    for (const key of APP_THEME_COMPONENT_KEYS) {
        const componentPath = customConfig[key];
        if (!componentPath) {
            continue;
        }

        const moduleKey = resolveThemeComponentModuleKey(
            themeDirName,
            componentPath
        );

        if (!moduleKey) {
            warnThemeComponentFallback(themeDirName, key, componentPath);
            continue;
        }

        const loader = themeVueModules[moduleKey];
        if (!loader) {
            warnThemeComponentFallback(themeDirName, key, componentPath);
            continue;
        }

        componentMap[key] = getMemoizedAsyncThemeComponent(
            `${themeDirName}:${key}`,
            moduleKey,
            loader
        );
    }

    return componentMap;
}

export function invalidateThemeComponentCache(themeDirName: string): void {
    const themeCachePrefix = `${themeDirName}:`;

    for (const key of [...asyncChunkCache.keys()]) {
        if (key.startsWith(themeCachePrefix)) {
            asyncChunkCache.delete(key);
        }
    }
}
