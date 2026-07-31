import { useRuntimeConfig } from '#imports';

export function isWebhooksEnabled(): boolean {
    const config = useRuntimeConfig();
    return config.auth.enabled === true && config.webhooks.enabled === true;
}
