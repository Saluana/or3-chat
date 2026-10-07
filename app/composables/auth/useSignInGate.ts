/**
 * Sign-in gate for deployments that require an account to chat.
 *
 * Static/local builds (SSR auth off) and guest-enabled deployments never
 * require sign-in, so callers keep their existing OpenRouter-key behavior.
 */
import { computed, watch } from 'vue';
import { useRuntimeConfig, useToast } from '#imports';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { isMobile } from '~/state/global';

export const SIGN_IN_PROMPT = 'Sign in to start chatting';
export const INVITE_PROMPT = "You're invited";

let invitePrompted = false;

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

    // Invite links (`/?invite=`) open registration from the account control.
    // On mobile that control is inside More, so say where to find it once.
    if (import.meta.client) {
        // The layout flag settles after mount, possibly after the session loads.
        watch([signInRequired, isMobile], ([required, mobile]) => {
            if (!required || invitePrompted || !mobile) return;
            if (!new URLSearchParams(window.location.search).get('invite')?.trim()) return;
            invitePrompted = true;
            toast.add({
                id: 'invite-sign-in',
                title: INVITE_PROMPT,
                description: 'Open the menu, tap More, then Login to create your account.',
                color: 'primary',
                duration: 10000,
            });
        }, { immediate: true });
    }

    function promptSignIn(): void {
        toast.add({
            id: 'need-sign-in',
            title: SIGN_IN_PROMPT,
            description: isMobile.value
                ? 'Open the menu, tap More, then Login.'
                : 'Use Login in the sidebar.',
            color: 'primary',
            duration: 6000,
        });
    }

    return { signInRequired, promptSignIn };
}
