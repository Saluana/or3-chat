import type { InjectionKey, ShallowRef } from 'vue';
import type { DashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';

export type DashboardNavigationErrorCode =
    | 'missing-plugin'
    | 'missing-page'
    | 'handler-error'
    | 'resolve-error';

export interface DashboardNavigationError {
    code: DashboardNavigationErrorCode;
    message: string;
    pluginId?: string;
    pageId?: string;
    cause?: unknown;
}

export interface DashboardNavigationState {
    view: 'dashboard' | 'page';
    activePluginId: string | null;
    activePageId: string | null;
    loadingPage: boolean;
    error: DashboardNavigationError | null;
}

export type DashboardNavigationResult =
    | { ok: true }
    | { ok: false; error: DashboardNavigationError };

export interface UseDashboardNavigationOptions {
    baseItems?: DashboardPlugin[];
}

/**
 * A view a dashboard page opens inside itself. The dashboard shell shows its
 * title, and its back link (labelled with the page title) calls `back`.
 */
export interface DashboardSubpage {
    title: string;
    back: () => void;
}

export const DASHBOARD_SUBPAGE_KEY: InjectionKey<ShallowRef<DashboardSubpage | null>> =
    Symbol('or3:dashboard:subpage');
