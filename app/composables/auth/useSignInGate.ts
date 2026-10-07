/**
 * Sign-in gate for deployments that require an account to chat.
 *
 * Static/local builds (SSR auth off) and guest-enabled deployments never
 * require sign-in, so callers keep their existing OpenRouter-key behavior.
 */
import { computed } from 'vue';
import { useRuntimeConfig, useToast } from '#imports';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { isMobile } from '~/state/global';

export const SIGN_IN_PROMPT = 'Sign in to start chatting';

export function useSignInGate() {
    const config = useRuntimeConfig();
    // Resolve while setup is active; send handlers can run after it ends.
    const toast = useToast();
    const { data } = useSessionContext();

    // Stays false until the session payload has loaded, so a slow fetch never
    // tells a signed-in user to sign in.
    const signInRequired = computed(
        () =>
            config.public.ssrAuthEnabled === true &&
            config.public.guestAccessEnabled !== true &&
            data.value !== null &&
            data.value.session?.authenticated !== true
    );

    function promptSignIn(): void {
        toast.add({
            id: 'need-sign-in',
            title: SIGN_IN_PROMPT,
            description: isMobile.value
                ? 'Open More, then tap Login.'
                : 'Use Login in the sidebar.',
            color: 'primary',
            duration: 6000,
        });
    }

    return { signInRequired, promptSignIn };
}
