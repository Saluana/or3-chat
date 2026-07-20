import { createHookEngine as createV1HookEngine } from '~~/shared/hooks/hook-engine-core';
import type { HookEngine } from '~~/shared/hooks/hook-engine-core';
import { createHookEngineV2 } from '~~/shared/hooks/hook-engine-v2';
import { reportError, err } from '~/utils/errors';

export type HookEngineVersion = 'v1' | 'v2';

export interface ClientHookEngineGlobal {
    __NUXT_HOOKS__?: HookEngine;
    __NUXT_HOOKS_VERSION__?: HookEngineVersion;
}

function options() {
    return {
        logCallbackError({
            error,
            isFilter,
            name,
        }: {
            error: unknown;
            isFilter: boolean;
            name: string;
        }) {
            console.error(
                `[hooks] Error in ${isFilter ? 'filter' : 'action'} "${name}":`,
                error,
            );
        },
        onOffError() {
            reportError(err('ERR_INTERNAL', 'hook disposer failed'), {
                silent: true,
                tags: { domain: 'hooks', stage: 'off' },
            });
        },
    };
}

export function createAppHookEngine(version: HookEngineVersion): HookEngine {
    return version === 'v2'
        ? createHookEngineV2(options())
        : createV1HookEngine(options());
}

export function getOrCreateClientHookEngine(
    global: ClientHookEngineGlobal,
    version: HookEngineVersion,
): HookEngine {
    if (!global.__NUXT_HOOKS__) {
        global.__NUXT_HOOKS__ = createAppHookEngine(version);
        global.__NUXT_HOOKS_VERSION__ = version;
    }
    return global.__NUXT_HOOKS__;
}

export function createSsrHookEngine(version: HookEngineVersion): HookEngine {
    return createAppHookEngine(version);
}
