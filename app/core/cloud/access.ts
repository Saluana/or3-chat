import { useRuntimeConfig } from '#imports';
import { getCachedSessionPayload, useSessionContext } from '~/composables/auth/useSessionContext';
import { cloudAccessAllowed } from '~~/shared/cloud/access';
import { computed, ref, watch, onScopeDispose } from 'vue';

/** Client scheduling hint only; the server enforces the current policy independently. */
export function hasCloudAccess(): boolean {
    const required = useRuntimeConfig().public.cloudAccessPolicyEnabled === true;
    return !required || cloudAccessAllowed(getCachedSessionPayload()?.cloudAccess, true);
}

/** Reactive expiry also stops transport without waiting for another successful request. */
export function useCloudAccess() {
    const required = useRuntimeConfig().public.cloudAccessPolicyEnabled === true;
    const session = useSessionContext();
    const now = ref(Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
        if (timer) clearTimeout(timer);
        now.value = Date.now();
        const access = session.data.value?.cloudAccess;
        if (access?.enabled && access.expiresAt > now.value) {
            timer = setTimeout(arm, Math.min(access.expiresAt - now.value + 1, 2_147_483_647));
        }
    };
    watch(() => session.data.value?.cloudAccess, arm, { immediate: true });
    onScopeDispose(() => { if (timer) clearTimeout(timer); });
    return computed(() => cloudAccessAllowed(session.data.value?.cloudAccess, required, now.value));
}
