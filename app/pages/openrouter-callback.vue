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
                    class="w-5 h-5 rounded-full border-2 border-neutral-300 border-t-neutral-700 dark:border-neutral-700 dark:border-t-white animate-spin"
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

<script setup>
import { reportError, err } from '~/utils/errors';
import { kv } from '~/db';
import { state } from '~/state/global';

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

function log(...args) {
    try {
        if (import.meta.dev) {
            // eslint-disable-next-line no-console
            console.debug('[openrouter-callback]', ...args);
        }
    } catch {}
}

async function setKVNonBlocking(key, value, timeoutMs = 300) {
    try {
        if (!kv?.set) return;
        log(`syncing key to KV via kvByName.set (timeout ${timeoutMs}ms)`);
        const result = await Promise.race([
            kv.set(key, value),
            new Promise((res) => setTimeout(() => res('timeout'), timeoutMs)),
        ]);
        if (result === 'timeout') log('setKV timed out; continuing');
        else log('setKV resolved');
    } catch (e) {
        log('setKV failed', e?.message || e);
    }
}

async function goHome() {
    redirecting.value = true;
    log("goHome() invoked. Trying router.replace('/').");
    try {
        await router.replace('/');
        log("router.replace('/') resolved");
    } catch (e) {
        log("router.replace('/') failed:", e?.message || e);
    }
    try {
        // Fallback to full document navigation
        log("Attempting window.location.replace('/')");
        window.location.replace('/');
    } catch (e) {
        log("window.location.replace('/') failed:", e?.message || e);
    }
    // Last-chance fallback on browsers that ignore replace
    setTimeout(() => {
        try {
            log("Attempting final window.location.assign('/')");
            window.location.assign('/');
        } catch (e) {
            log("window.location.assign('/') failed:", e?.message || e);
        }
    }, 150);
}

onMounted(async () => {
    log('mounted at', window.location.href, 'referrer:', document.referrer);
    const code = route.query.code;
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

    try {
        // Call OpenRouter directly per docs: https://openrouter.ai/api/v1/auth/keys
        log('exchanging code with OpenRouter', {
            endpoint: 'https://openrouter.ai/api/v1/auth/keys',
            codeLength: String(code).length,
            method: codeMethod,
            usingHTTPS: true,
        });
        const directResp = await fetch(
            'https://openrouter.ai/api/v1/auth/keys',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: String(code),
                    code_verifier: verifier,
                    code_challenge_method: codeMethod,
                }),
            }
        );
        const directJson = await directResp.json().catch(async () => {
            const text = await directResp.text().catch(() => '<no-body>');
            log('non-JSON response body snippet:', text?.slice(0, 300));
            return null;
        });
        if (!directResp.ok || !directJson) {
            reportError(
                err('ERR_NETWORK', 'Auth code exchange failed', {
                    severity: 'error',
                    tags: {
                        domain: 'auth',
                        page: 'openrouter-callback',
                        status: directResp.status,
                    },
                }),
                { toast: true }
            );
            return;
        }
        const userKey = directJson.key || directJson.access_token;
        if (!userKey) {
            reportError(
                err('ERR_AUTH', 'Auth exchange returned no key', {
                    severity: 'error',
                    tags: {
                        domain: 'auth',
                        page: 'openrouter-callback',
                        keys: Object.keys(directJson || {}).length,
                    },
                }),
                { toast: true }
            );
            return;
        }
        // store in localStorage for use by front-end
        log('storing key in localStorage (length)', String(userKey).length);
        // Save a human-readable name and the value; id/clock are handled
        // inside the helper to match your schema
        try {
            await kv.set('openrouter_api_key', userKey);
            // Update global state immediately so UI reacts even before listeners.
            try {
                state.value.openrouterKey = userKey;
            } catch {}
        } catch (e) {
            log('kvByName.set failed', e?.message || e);
        }
        try {
            log('dispatching openrouter:connected event');
            window.dispatchEvent(new CustomEvent('openrouter:connected'));
            // Best-effort: also persist to synced KV
            try {
                await setKVNonBlocking('openrouter_api_key', userKey, 300);
            } catch {}
        } catch {}
        log('clearing session markers (verifier/state/method)');
        const keys = [
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
        // Attempt auto-redirect but keep the Continue button visible
        setTimeout(() => {
            // first SPA attempt
            log("auto: router.replace('/')");
            router.replace('/').catch((e) => {
                log('auto: router.replace failed', e?.message || e);
            });

            setTimeout(() => {
                try {
                    log("auto: window.location.replace('/')");
                    window.location.replace('/');
                } catch (e) {
                    log(
                        'auto: window.location.replace failed',
                        e?.message || e
                    );
                }
            }, 250);
        }, 50);
    } catch (err) {
        reportError(err, {
            code: 'ERR_NETWORK',
            tags: { domain: 'auth', page: 'openrouter-callback' },
            toast: true,
        });
        loading.value = false;
        ready.value = true;
        errorMessage.value =
            'Authentication finished, but we couldn’t auto-redirect.';
    }
    // Safety: if nothing happened within 4s (no ready), force a hard reload to bust SW fallback
    setTimeout(() => {
        if (!ready.value && !errorMessage.value) {
            try {
                log('safety reload firing');
                window.location.reload();
            } catch {}
        }
    }, 4000);
});
</script>
