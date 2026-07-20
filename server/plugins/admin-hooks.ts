import { defineNitroPlugin } from 'nitropack/runtime';
import { createTypedAdminHookEngine } from '../hooks';
import { createServerHookEngine } from '../hooks/runtime-kernel';

export default defineNitroPlugin((nitroApp) => {
    const runtimeConfig = useRuntimeConfig();
    const version =
        runtimeConfig.public?.admin?.hookEngineV2Enabled === true ? 'v2' : 'v1';
    nitroApp.hooks.hook('request', (event) => {
        const engine = createServerHookEngine(version);
        const typed = createTypedAdminHookEngine(engine);
        const forwardAdminHook = nitroApp.hooks.callHook as (
            name: string,
            ...args: unknown[]
        ) => Promise<unknown>;
        const doAction = typed.doAction as (
            name: string,
            ...args: unknown[]
        ) => Promise<void>;
        const doActionSync = typed.doActionSync as (
            name: string,
            ...args: unknown[]
        ) => void;
        event.context.adminHooks = {
            ...typed,
            async doAction(name: string, ...args: unknown[]) {
                await doAction(name, ...args);
                await forwardAdminHook(name, ...args);
            },
            doActionSync(name: string, ...args: unknown[]) {
                doActionSync(name, ...args);
                void forwardAdminHook(name, ...args);
            },
        };
    });
});
