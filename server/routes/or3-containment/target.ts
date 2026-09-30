/**
 * Containment probe target: a real, reachable endpoint on the host origin.
 *
 * The qualification suite needs a destination that is genuinely reachable so a
 * blocked probe is a *policy* denial rather than an unavailable target. It is
 * inert JSON and only exists while the probe routes are enabled.
 */
import { createError, defineEventHandler } from 'h3';
import { useRuntimeConfig } from '#imports';

export default defineEventHandler(() => {
    const config = useRuntimeConfig();
    const enabled = Boolean(
        (config.admin as { containmentProbeEnabled?: boolean } | undefined)
            ?.containmentProbeEnabled
    );
    if (!enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    return { target: 'or3-containment', reachable: true };
});
