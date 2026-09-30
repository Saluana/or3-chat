/**
 * Containment probe script target: a real, reachable script on the host origin.
 *
 * `importScripts` and dynamic `import()` are probed against this file, and the
 * uncontained control worker loads it successfully. It is inert, declares
 * nothing global that a second load would collide with, and only exists while
 * the probe routes are enabled.
 */
import { createError, defineEventHandler, setHeader } from 'h3';
import { useRuntimeConfig } from '#imports';

export const PROBE_SCRIPT_SOURCE = 'globalThis.__or3ContainmentProbeScriptLoads = (globalThis.__or3ContainmentProbeScriptLoads || 0) + 1;\n';

export default defineEventHandler((event) => {
    const config = useRuntimeConfig();
    const enabled = Boolean(
        (config.admin as { containmentProbeEnabled?: boolean } | undefined)
            ?.containmentProbeEnabled
    );
    if (!enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    setHeader(event, 'content-type', 'text/javascript; charset=utf-8');
    setHeader(event, 'cache-control', 'no-store');
    return PROBE_SCRIPT_SOURCE;
});
