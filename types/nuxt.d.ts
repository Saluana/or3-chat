// Type augmentation for the theme plugin
declare module '#app' {
    interface NuxtApp {
        $theme: {
            // Original theme API (light/dark mode)
            set: (name: string) => void;
            toggle: () => void;
            get: () => string;
            system: () => 'light' | 'dark';
            current: import('vue').Ref<string>;

            // Refined theme system API (theme variants)
            activeTheme: import('vue').Ref<string>;
            setActiveTheme: (themeName: string) => Promise<void>;
            getResolver: (
                themeName: string
            ) =>
                | import('~/theme/_shared/runtime-resolver').RuntimeResolver
                | null;
            loadCompiledTheme: (
                themeName: string
            ) => Promise<import('~/theme/_shared/types').CompiledTheme | null>;
        };
        $hooks: import('../app/utils/typed-hooks').TypedHookEngine;

        $workflowSlash?: {
            stop: () => boolean;
            isExecuting: () => boolean;
            retry: (messageId: string) => Promise<boolean>;
            respondHitl: (
                requestId: string,
                action: import('~/utils/chat/workflow-types').HitlAction,
                data?: string | Record<string, unknown>
            ) => boolean;
        };
    }
}

export {};
