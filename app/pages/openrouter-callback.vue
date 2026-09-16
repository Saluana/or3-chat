<template>
    <div
        class="min-h-[100dvh] flex items-center justify-center p-6"
        data-page="openrouter-callback"
    >
        <div
            class="w-full max-w-md rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-neutral-200/60 dark:border-neutral-800/60 bg-white/70 dark:bg-neutral-900/70 backdrop-blur p-5 text-center"
        >
            <p class="text-base font-medium mb-2">
                {{ title }}
            </p>
            <p class="text-sm text-neutral-500 mb-4">
                {{ subtitle }}
            </p>
            <div class="flex items-center justify-center gap-3">
                <div
                    v-if="loading"
                    class="w-5 h-5 rounded-full border-[var(--md-border-width)] border-neutral-300 border-t-neutral-700 dark:border-neutral-700 dark:border-t-white animate-spin"
                />
                <button
                    v-if="ready"
                    class="px-4 py-2 rounded-[var(--md-border-radius-small,0.375rem)] bg-primary-600 text-white hover:bg-primary-500"
                    @click="goHome"
                >
                    Continue
                </button>
                <button
                    v-if="errorMessage"
                    class="px-4 py-2 rounded-[var(--md-border-radius-small,0.375rem)] bg-amber-600 text-white hover:bg-amber-500"
                    @click="startAgain"
                >
                    Start connection again
                </button>
                <button
                    v-if="errorMessage"
                    class="px-4 py-2 rounded-[var(--md-border-radius-small,0.375rem)] border border-neutral-300 dark:border-neutral-700"
                    @click="goHome"
                >
                    Go Home
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useToast } from '#imports';
import { reportError, err } from '~/utils/errors';
import { exchangeOpenRouterCode } from '~/core/auth/openrouter-auth';
import { persistUserApiKey } from '~/core/auth/useUserApiKey';
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';

const route = useRoute();
const router = useRouter();
const rc = useRuntimeConfig();
const { startLogin } = useOpenRouterAuth();

const PKCE_MARKER_KEYS = [
    'openrouter_auth_code',
    'openrouter_code_verifier',
    'openrouter_state',
    'openrouter_code_method',
];

const loading = ref(true);
const ready = ref(false);
const redirecting = ref(false);
const errorMessage = ref('');
// A confirmed CSP violation is distinct from an unclassified network failure.
const cspViolation = ref(false);

function clearPkceMarkers() {
    PKCE_MARKER_KEYS.forEach((key) => {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
    });
}

/**
 * Only an enforced connection directive that blocked an OpenRouter origin
 * indicates the exchange could not reach OpenRouter. Any other violation (for
 * example an unrelated image or style directive) is not evidence of that.
 */
function onSecurityPolicyViolation(event: SecurityPolicyViolationEvent) {
    const directive = event.effectiveDirective || event.violatedDirective || '';
    const connectionDirective = directive === 'connect-src' || directive === 'default-src';
    const blocked = event.blockedURI || '';
    let blockedOpenRouter = false;
    try {
        blockedOpenRouter = new URL(blocked).origin === 'https://openrouter.ai';
    } catch {
        blockedOpenRouter = blocked.includes('openrouter.ai');
    }
    if (connectionDirective && blockedOpenRouter) cspViolation.value = true;
}

/** Discards the used authorization attempt and starts a fresh PKCE flow. */
async function startAgain() {
    clearPkceMarkers();
    errorMessage.value = '';
    cspViolation.value = false;
    ready.value = false;
    loading.value = true;
    try {
        await startLogin();
    } catch (e: any) {
        loading.value = false;
        ready.value = true;
        errorMessage.value =
            'Could not start the connection again. Return home and retry from the chat screen.';
    }
}
const title = computed(() =>
    errorMessage.value
        ? 'OpenRouter connection not completed'
        : ready.value
        ? 'Login complete'
        : 'Completing login…'
);
const subtitle = computed(() => {
    if (errorMessage.value) return errorMessage.value;
    if (ready.value && !redirecting.value)
        return 'If this page doesn’t redirect automatically, tap Continue.';
    return 'Please wait while we finish setup.';
});

function log(...args: any[]) {
    try {
        if (import.meta.dev) {
            // eslint-disable-next-line no-console
            console.debug('[openrouter-callback]', ...args);
        }
    } catch (e) {
        // intentionally ignored: debug logging failure (dev-only)
    }
}

async function goHome() {
    redirecting.value = true;
    log("goHome() invoked. Trying router.replace('/').");
    try {
        await router.replace('/');
        log("router.replace('/') resolved");
        return;
    } catch (e: any) {
        // intentionally ignored: navigation fallback
    }
    try {
        // Fallback to full document navigation
        log("Attempting window.location.replace('/')");
        window.location.replace('/');
    } catch (e: any) {
        // intentionally ignored: navigation fallback
    }
}

onMounted(async () => {
    log('mounted at', window.location.href, 'referrer:', document.referrer);
    document.addEventListener('securitypolicyviolation', onSecurityPolicyViolation);
    const code =
        route.query.code ||
        sessionStorage.getItem('openrouter_auth_code') ||
        localStorage.getItem('openrouter_auth_code') ||
        '';
    const state = route.query.state;
    // Primary in sessionStorage (original), fallback to localStorage if a reload or restore lost it.
    const verifier =
        sessionStorage.getItem('openrouter_code_verifier') ||
        localStorage.getItem('openrouter_code_verifier') ||
        '';
    const savedState =
        sessionStorage.getItem('openrouter_state') ||
        localStorage.getItem('openrouter_state') ||
        '';
    const codeMethod =
        sessionStorage.getItem('openrouter_code_method') ||
        localStorage.getItem('openrouter_code_method') ||
        'S256';
    log('query params present:', {
        code: Boolean(code),
        state: Boolean(state),
    });
    log('session present:', {
        verifier: Boolean(verifier),
        savedState: Boolean(savedState),
        codeMethod,
    });

    if (!code || !verifier) {
        const missing = !code ? 'code' : 'verifier';
        reportError(
            err('ERR_AUTH', `Missing ${missing}`, {
                severity: 'warn',
                tags: { domain: 'auth', page: 'openrouter-callback', missing },
            }),
            { toast: true }
        );
        loading.value = false;
        ready.value = true;
        errorMessage.value =
            missing === 'code'
                ? 'OpenRouter did not return an authorization code. Start the connection again.'
                : 'This connection was started in a different browser or address. Start it again from this address.';
        return;
    }
    if (savedState && state !== savedState) {
        reportError(
            err('ERR_AUTH', 'State mismatch (possible CSRF)', {
                severity: 'error',
                tags: { domain: 'auth', page: 'openrouter-callback' },
            }),
            { toast: true }
        );
        loading.value = false;
        ready.value = true;
        errorMessage.value = 'State mismatch. Tap Continue to return.';
        return;
    }

    let attempt = 0;
    const doExchange = async (): Promise<boolean> => {
        attempt++;
        const result = await exchangeOpenRouterCode({
            code: String(code),
            verifier,
            codeMethod,
            attempt,
        });
        if (!result.ok) {
            // One UI layer, one error. The used authorization code is never
            // replayed automatically; the user explicitly starts a fresh flow.
            if (result.reason === 'no-key') {
                errorMessage.value = 'No key was returned. Start the connection again.';
            } else if (cspViolation.value) {
                errorMessage.value =
                    'This browser blocked the OpenRouter connection (Content-Security-Policy). Start the connection again, or check the deployment CSP allows https://openrouter.ai.';
            } else {
                errorMessage.value = 'The connection could not be completed. Start the connection again.';
            }
            reportError(
                err(cspViolation.value ? 'ERR_AUTH' : result.errorCode || 'ERR_NETWORK', 'Auth code exchange failed', {
                    severity: 'error',
                    tags: {
                        domain: 'auth',
                        page: 'openrouter-callback',
                        status: result.status,
                        attempt,
                        csp: cspViolation.value,
                    },
                    retryable: false,
                }),
                { toast: true }
            );
            clearPkceMarkers();
            loading.value = false;
            ready.value = true;
            return false;
        }
        const userKey = result.userKey;
        log('persisting key via persistUserApiKey (length)', String(userKey).length);
        try {
            await persistUserApiKey(userKey);
        } catch (e: any) {
            loading.value = false;
            ready.value = true;
            errorMessage.value = 'OpenRouter returned a key in an unexpected format. Start the connection again.';
            reportError(
                err('ERR_AUTH', 'Auth code exchange returned an invalid key', {
                    severity: 'error',
                    tags: { domain: 'auth', page: 'openrouter-callback', status: result.status },
                    retryable: false,
                }),
                { toast: true }
            );
            clearPkceMarkers();
            return false;
        }
        log('clearing session markers (verifier/state/method)');
        clearPkceMarkers();
        // Allow event loop to process storage events in other tabs/components
        await new Promise((r) => setTimeout(r, 10));
        loading.value = false;
        ready.value = true;
        useToast().add({
            title: 'OpenRouter connected',
            description: 'Your API key was saved. You can start chatting now.',
            color: 'primary',
            duration: 4000,
        });
        log('ready to redirect');
        setTimeout(() => {
            void goHome();
        }, 50);
        return true;
    };
    const success = await doExchange();
    if (!success) return;
    loading.value = false;
    ready.value = true;
    // Safety: if nothing happened within 4s (no ready), force a hard reload to bust SW fallback
    setTimeout(() => {
        if (!ready.value && !errorMessage.value) {
            try {
                log('safety reload firing');
                window.location.reload();
            } catch (e) {
                // intentionally ignored: safety reload failure
            }
        }
    }, 4000);
});

onBeforeUnmount(() => {
    document.removeEventListener('securitypolicyviolation', onSecurityPolicyViolation);
});
</script>
