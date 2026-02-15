// Type augmentation for the theme plugin
declare module '#app' {
    interface NuxtApp {
        $theme: {
            // Original theme API (light/dark mode)
            set: (name: string) => void;
            toggle: () => void;
            get: () => string;
            system: () => string;
            current: import('vue').Ref<string>;

            // Refined theme system API (theme variants)
            activeTheme: import('vue').Ref<string>;
            resolversVersion: import('vue').Ref<number>;
            setActiveTheme: (themeName: string) => Promise<void>;
            getResolver: (
                themeName: string
            ) =>
                | import('~/theme/_shared/runtime-resolver').RuntimeResolver
                | null;
            loadTheme: (
                themeName: string
            ) => Promise<import('~/theme/_shared/types').CompiledTheme | null>;
            getTheme: (
                themeName: string
            ) => import('~/theme/_shared/types').CompiledTheme | null;
        };
        $hooks: import('../app/utils/typed-hooks').TypedHookEngine;

        $workflowSlash?: {
            stop: () => boolean;
            isExecuting: () => boolean;
            retry: (messageId: string) => Promise<boolean>;
            respondHitl: (
                requestId: string,
                action: import('~/utils/chat/workflow-types').HitlAction,
                data?: string | Record<string, unknown>,
                jobId?: string
            ) => Promise<boolean>;
        };
    }
}

export {};
