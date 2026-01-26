import { createHookEngine, createTypedAdminHookEngine } from '../hooks';

export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('request', (event) => {
        const engine = createHookEngine();
        event.context.adminHooks = createTypedAdminHookEngine(engine);
    });
});
