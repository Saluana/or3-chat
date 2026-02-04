import { ConvexHttpClient } from 'convex/browser';
import { api } from '~~/convex/_generated/api';
import { useRuntimeConfig } from '#imports';

let client: ConvexHttpClient | null = null;

export function getConvexClient() {
    if (client) return client;

    const runtimeConfig = useRuntimeConfig();
    const url = runtimeConfig.sync.convexUrl;

    if (typeof url !== 'string' || url.length === 0) {
        throw new Error('CONVEX_URL is not defined in runtime config');
    }

    client = new ConvexHttpClient(url);
    return client;
}

export { api };
