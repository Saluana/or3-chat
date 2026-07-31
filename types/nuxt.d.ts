import type { ThemePlugin } from '~/theme/_shared/types';

// Type augmentation for the theme plugin
declare module '#app' {
    interface NuxtApp {
        $theme: ThemePlugin;
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

declare module 'vue' {
    interface ComponentCustomProperties {
        $theme: ThemePlugin;
    }
}

declare module '@vue/runtime-core' {
    interface ComponentCustomProperties {
        $theme: ThemePlugin;
    }
}

export {};
