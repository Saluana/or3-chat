/**
 * Containment qualification harness (task 4.13, finding 6).
 *
 * The real-browser qualification has to prove teardown through the *delivered*
 * startup API, not a test-only reimplementation. This client plugin exposes that
 * API on the host page, and only when the containment probe flag is enabled
 * (`OR3_CONTAINMENT_PROBE_ENABLED=true`), which no normal profile sets.
 *
 * Nothing here runs unless the flag is on: the dynamic imports are inside the
 * guard, so other builds never load the module for this purpose.
 */
export default defineNuxtPlugin(() => {
    if (!import.meta.client) return;
    const config = useRuntimeConfig();
    if (!config.public.containmentProbeEnabled) return;

    void (async () => {
        const [bootstrap, capabilityBridge] = await Promise.all([
            import('~~/shared/plugins/isolation/portable-bootstrap'),
            import('~~/shared/plugins/isolation/capability-bridge'),
        ]);
        (window as unknown as { __or3ContainmentHarness?: unknown }).__or3ContainmentHarness = {
            startPortableWorker: bootstrap.startPortableWorker,
            defaultHostAbi: bootstrap.defaultHostAbi,
            assessPortableHost: bootstrap.assessPortableHost,
            PORTABLE_PROFILE_NAME: bootstrap.PORTABLE_PROFILE_NAME,
            PORTABLE_CLIENT_FEATURE: bootstrap.PORTABLE_CLIENT_FEATURE,
            createRemoteCapabilityMethods: capabilityBridge.createRemoteCapabilityMethods,
            createHttpCapabilityTransport: capabilityBridge.createHttpCapabilityTransport,
            REMOTE_CAPABILITY_METHODS: capabilityBridge.REMOTE_CAPABILITY_METHODS,
        };
    })();
});
