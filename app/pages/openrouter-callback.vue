<template>
    <div
        class="min-h-[100dvh] flex items-center justify-center p-6"
        data-page="openrouter-callback"
    >
        <div
            class="w-full max-w-md rounded-xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/70 dark:bg-neutral-900/70 backdrop-blur p-5 text-center"
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
                    class="px-4 py-2 rounded-md bg-primary-600 text-white hover:bg-primary-500"
                    @click="goHome"
                >
                    Continue
                </button>
                <button
                    v-if="errorMessage"
                    class="px-4 py-2 rounded-md bg-amber-600 text-white hover:bg-amber-500"
                    @click="goHome"
                >
                    Go Home
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { reportError, err } from '~/utils/errors';
import { kv } from '~/db';
import { state } from '~/state/global';
import { exchangeOpenRouterCode } from '~/core/auth/openrouter-auth';

const route = useRoute();
const router = useRouter();
const rc = useRuntimeConfig();

const loading = ref(true);
const ready = ref(false);
const redirecting = ref(false);
const errorMessage = ref('');
const title = computed(() =>
    errorMessage.value
        ? 'Login completed with warnings'
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

async function setKVNonBlocking(key: string, value: string, timeoutMs = 300) {
    try {
        if (!kv?.set) return;
        log(`syncing key to KV via kvByName.set (timeout ${timeoutMs}ms)`);
        const result = await Promise.race([
            kv.set(key, value),
            new Promise((res) => setTimeout(() => res('timeout'), timeoutMs)),
        ]);
        if (result === 'timeout') log('setKV timed out; continuing');
        else log('setKV resolved');
    } catch (e: any) {
        // intentionally ignored: non-critical KV sync failure
    }
}

async function goHome() {
    redirecting.value = true;
    log("goHome() invoked. Trying router.replace('/').");
    try {
        await router.replace('/');
        log("router.replace('/') resolved");
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
    // Last-chance fallback on browsers that ignore replace
    setTimeout(() => {
        try {
            log("Attempting final window.location.assign('/')");
            window.location.assign('/');
        } catch (e: any) {
            // intentionally ignored: navigation fallback
        }
    }, 150);
}

onMounted(async () => {
    log('mounted at', window.location.href, 'referrer:', document.referrer);
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
        reportError(
            err('ERR_AUTH', 'Missing code or verifier', {
                severity: 'warn',
                tags: { domain: 'auth', page: 'openrouter-callback' },
            }),
            { toast: true }
        );
        loading.value = false;
        ready.value = true;
        errorMessage.value =
            'Missing code or verifier. Tap Continue to return.';
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
            // Provide user-facing message for first failure
            errorMessage.value =
                result.reason === 'no-key'
                    ? 'No key returned. Continue to finish.'
                    : 'Exchange failed. Retry or continue home.';
            // Attach retry closure only if network/bad-response
            if (result.reason !== 'no-key') {
                reportError(
                    err('ERR_NETWORK', 'Auth code exchange failed', {
                        severity: 'error',
                        tags: {
                            domain: 'auth',
                            page: 'openrouter-callback',
                            status: result.status,
                            attempt,
                        },
                        retryable: true,
                    }),
                    { toast: true, retry: doExchange }
                );
            }
            loading.value = false;
            ready.value = true;
            return false;
        }
        const userKey = result.userKey;
        // store in localStorage for use by front-end
        log('storing key in localStorage (length)', String(userKey).length);
        // Save a human-readable name and the value; id/clock are handled
        // inside the helper to match your schema
        try {
            await kv.set('openrouter_api_key', userKey);
            // Update global state immediately so UI reacts even before listeners.
            try {
                (state as any).value.openrouterKey = userKey;
            } catch (e) {
                // intentionally ignored: dispatch failure (no user impact)
            }
        } catch (e: any) {
            log('kvByName.set failed', (e && e.message) || e);
        }
        try {
            log('dispatching openrouter:connected event');
            window.dispatchEvent(new CustomEvent('openrouter:connected'));
            // Best-effort: also persist to synced KV
            try {
                await setKVNonBlocking('openrouter_api_key', userKey, 300);
            } catch (e) {
                // intentionally ignored: optional synced KV persistence
            }
        } catch (e) {
            // intentionally ignored: event dispatch failure
        }
        log('clearing session markers (verifier/state/method)');
        const keys = [
            'openrouter_auth_code',
            'openrouter_code_verifier',
            'openrouter_state',
            'openrouter_code_method',
        ];
        keys.forEach((k) => {
            sessionStorage.removeItem(k);
            localStorage.removeItem(k);
        });
        // Allow event loop to process storage events in other tabs/components
        await new Promise((r) => setTimeout(r, 10));
        loading.value = false;
        ready.value = true;
        log('ready to redirect');
        setTimeout(() => {
            log("auto: router.replace('/')");
            router.replace('/').catch((e: any) => {
                log('auto: router.replace failed', (e && e.message) || e);
            });
            setTimeout(() => {
                try {
                    log("auto: window.location.replace('/')");
                    window.location.replace('/');
                } catch (e: any) {
                    log(
                        'auto: window.location.replace failed',
                        (e && e.message) || e
                    );
                }
            }, 250);
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
</script>
