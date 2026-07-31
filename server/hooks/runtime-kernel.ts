import { createHookEngine as createV1HookEngine } from '~~/shared/hooks/hook-engine-core';
import type { HookEngine } from '~~/shared/hooks/hook-engine-core';
import { createHookEngineV2 } from '~~/shared/hooks/hook-engine-v2';

export type ServerHookEngineVersion = 'v1' | 'v2';

export function createServerHookEngine(
    version: ServerHookEngineVersion,
): HookEngine {
    const options = {
        resolveOnKind(
            name: string,
            explicitKind: 'action' | 'filter' | undefined,
        ) {
            return (
                explicitKind ??
                (name.includes(':filter:') ? 'filter' : 'action')
            );
        },
        logCallbackError({ error, name }: { error: unknown; name: string }) {
            try {
                console.error('[admin-hooks]', name, error);
            } catch {
                /* ignore */
            }
        },
    };
    return version === 'v2'
        ? createHookEngineV2(options)
        : createV1HookEngine(options);
}
