import { onUnmounted, ref } from 'vue';
import { useAuthTokenBroker } from './useAuthTokenBroker.client';
import {
    CONVEX_JWT_TEMPLATE,
    CONVEX_PROVIDER_ID,
} from '~~/shared/cloud/provider-ids';

/**
 * Periodically refresh the session token to ensure it remains valid.
 */
export function useSessionRefresh() {
    const tokenBroker = useAuthTokenBroker();
    const refreshInterval = ref<ReturnType<typeof setInterval> | null>(null);

    function startRefresh(intervalMs = 5 * 60 * 1000) {
        if (refreshInterval.value) return;

        refreshInterval.value = setInterval(async () => {
            try {
                // Refresh token from provider
                // Note: The template ID depends on the provider (e.g. Convex).
                // Keep this aligned with server session resolution and provider constants.
                const token = await tokenBroker.getProviderToken({
                    providerId: CONVEX_PROVIDER_ID,
                    template: CONVEX_JWT_TEMPLATE,
                });

                if (!token) {
                    console.warn('[session-refresh] Failed to refresh token');
                }
            } catch (error) {
                console.error('[session-refresh] Refresh error:', error);
            }
        }, intervalMs);
    }

    function stopRefresh() {
        if (refreshInterval.value) {
            clearInterval(refreshInterval.value);
            refreshInterval.value = null;
        }
    }

    onUnmounted(() => {
        stopRefresh();
    });

    return {
        startRefresh,
        stopRefresh,
    };
}
