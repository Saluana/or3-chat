import { defineNitroPlugin } from 'nitropack/runtime';
import { createHookEngine, createTypedAdminHookEngine } from '../hooks';

export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('request', (event) => {
        const engine = createHookEngine();
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
