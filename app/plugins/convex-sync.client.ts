/** Load the sync implementation only in deployments that enable it. */
export default defineNuxtPlugin(async () => {
    if (import.meta.server || !useRuntimeConfig().public.sync?.enabled) return;
    const { setupSyncEngine } = await import('~/core/sync/client-sync-engine');
    await setupSyncEngine();
});
