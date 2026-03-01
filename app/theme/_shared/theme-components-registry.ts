import { defineAsyncComponent, type Component } from 'vue';
import ChatContainer from '~/components/chat/ChatContainer.vue';
import ChatInputDropper from '~/components/chat/ChatInputDropper.vue';
import ChatMessage from '~/components/chat/ChatMessage.vue';
import ModelSelect from '~/components/chat/ModelSelect.vue';
import DocumentationShell from '~/components/DocumentationShell.vue';
import SideBar from '~/components/sidebar/SideBar.vue';
import SideNavContentCollapsed from '~/components/sidebar/SideNavContentCollapsed.vue';
import SidebarAuthButton from '~/components/sidebar/SidebarAuthButton.vue';
import WorkflowExecutionStatus from '~/components/chat/WorkflowExecutionStatus.vue';
import {
    APP_THEME_COMPONENT_KEYS,
    type AppThemeComponent,
} from './types';

type ThemeComponentLoader = () => Promise<Component>;

const themeVueModules = import.meta.glob('../*/**/*.vue', {
    import: 'default',
}) as Record<string, ThemeComponentLoader>;

const asyncChunkCache = new Map<
    string,
    { moduleKey: string; component: Component }
>();

const DashboardModalDefault = defineAsyncComponent(
    () => import('~/components/dashboard/Dashboard.vue')
);

const SystemPromptsModalDefault = defineAsyncComponent(
    () => import('~/components/chat/SystemPromptsModal.vue')
);

const ModelCatalogModalDefault = defineAsyncComponent(
    () => import('~/components/modal/ModelCatalog.vue')
);

const DocumentEditorDefault = defineAsyncComponent(
    () => import('~/components/documents/DocumentEditor.vue')
);

export const CORE_APP_COMPONENT_DEFAULTS: Record<AppThemeComponent, Component> =
    {
        sidebar: SideBar,
        'sidebar-collapsed': SideNavContentCollapsed,
        'chat-page': ChatContainer,
        'chat-message': ChatMessage,
        'chat-input': ChatInputDropper,
        'document-editor': DocumentEditorDefault,
        'dashboard-modal': DashboardModalDefault,
        'model-selector': ModelSelect,
        'system-prompts-modal': SystemPromptsModalDefault,
        'model-catalog-modal': ModelCatalogModalDefault,
        'sidebar-auth-button': SidebarAuthButton,
        'documentation-shell': DocumentationShell,
        'workflow-status': WorkflowExecutionStatus,
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
