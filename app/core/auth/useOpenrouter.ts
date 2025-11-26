import { ref } from 'vue';
import { useRuntimeConfig } from '#imports';
import { kv } from '~/db';

function base64urlencode(str: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(str)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function sha256(plain: string) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return await crypto.subtle.digest('SHA-256', data);
}

export function useOpenRouterAuth() {
    const isLoggingIn = ref(false);

    const startLogin = async () => {
        if (isLoggingIn.value) return;
        isLoggingIn.value = true;
        const codeVerifier = Array.from(
            crypto.getRandomValues(new Uint8Array(64))
        )
            .map((b) => ('0' + b.toString(16)).slice(-2))
            .join('');
        // Compute PKCE code_challenge. Prefer S256, but fall back to "plain"
        // when SubtleCrypto is unavailable (e.g., iOS Safari on non-HTTPS).
        let codeChallenge = codeVerifier;
        let codeChallengeMethod: 'S256' | 'plain' = 'plain';
        try {
            if (
                typeof crypto !== 'undefined' &&
                typeof crypto.subtle?.digest === 'function'
            ) {
                const challengeBuffer = await sha256(codeVerifier);
                codeChallenge = base64urlencode(challengeBuffer);
                codeChallengeMethod = 'S256';
            }
        } catch {
            // Keep plain fallback
            codeChallenge = codeVerifier;
            codeChallengeMethod = 'plain';
        }
        // store the method so the callback knows how to exchange
        try {
            sessionStorage.setItem(
                'openrouter_code_method',
                codeChallengeMethod
            );
        } catch {
            // sessionStorage may fail in private browsing - continue anyway
        }
        // store a random state to protect against CSRF
        const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map((b) => ('0' + b.toString(16)).slice(-2))
            .join('');
        sessionStorage.setItem('openrouter_state', state);

        const rc = useRuntimeConfig();
        // default callback to current origin + known path when not provided
        const redirectUri = rc.public.openRouterRedirectUri;
        const callbackUrl =
            (typeof redirectUri === 'string' && redirectUri) ||
            `${window.location.origin}/openrouter-callback`;

        const params = new URLSearchParams();
        // Per docs, only callback_url, code_challenge(+method), and optional state are required
        // OpenRouter expects a 'callback_url' parameter
        params.append('callback_url', callbackUrl);
        params.append('state', state);
        params.append('code_challenge', codeChallenge);
        params.append('code_challenge_method', codeChallengeMethod);
        // If you have a registered app on OpenRouter, including client_id helps avoid
        // app auto-creation based on referrer (which can be flaky on mobile).
        const clientId = rc.public.openRouterClientId as string | undefined;
        if (clientId) params.append('client_id', String(clientId));

        const authUrlConfig = rc.public.openRouterAuthUrl;
        const authUrl = (typeof authUrlConfig === 'string' && authUrlConfig) || 'https://openrouter.ai/auth';
        const url = `${authUrl}?${params.toString()}`;

        // Warn if callback URL is not HTTPS or localhost (common iOS issue)
        try {
            const u = new URL(callbackUrl);
            const isLocalhost = ['localhost', '127.0.0.1'].includes(u.hostname);
            const isHttps = u.protocol === 'https:';
            if (!isHttps && !isLocalhost) {
                console.warn(
                    'OpenRouter PKCE: non-HTTPS, non-localhost callback_url detected. On mobile, use a public HTTPS tunnel and set OPENROUTER_REDIRECT_URI.',
                    callbackUrl
                );
            }
        } catch {
            // Invalid URL - skip warning
        }

        // Debug (dev only): final URL for parameter inspection
        if (import.meta.dev) {
             
            console.debug('OpenRouter PKCE redirect URL:', url);
        }

        // Use assign to ensure history behaves consistently across mobile browsers
        window.location.assign(url);
    };

    const logoutOpenRouter = async () => {
        try {
            // Remove local copy immediately for UX
            if (typeof window !== 'undefined') {
                localStorage.removeItem('openrouter_api_key');
            }
            // Best-effort: clear synced KV by setting empty
            try {
                await kv.delete('openrouter_api_key');
            } catch {
                // KV delete may fail - non-critical
            }
            // Notify UI listeners (Sidebar, etc.) to recompute state
            try {
                window.dispatchEvent(new CustomEvent('openrouter:connected'));
            } catch {
                // Event dispatch may fail in SSR - non-critical
            }
        } catch (e) {
            console.error('OpenRouter logout failed', e);
        }
    };

    return { startLogin, logoutOpenRouter, isLoggingIn };
}
