// Early capture of OpenRouter OAuth params to reduce chance of SW/navigation race.
// If landing on /openrouter-callback with code/state in query, persist them ASAP
// (in both sessionStorage and localStorage) then strip them from the visible URL
// so future reloads don't rely on SW matching query variants.
import { reportError, err } from '~/utils/errors';

export default defineNuxtPlugin(() => {
    if (process.server) return;
    try {
        const loc = window.location;
        if (loc.pathname === '/openrouter-callback') {
            const url = new URL(loc.href);
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            if (code) {
                sessionStorage.setItem('openrouter_auth_code', code);
                localStorage.setItem('openrouter_auth_code', code);
                sessionStorage.setItem(
                    'openrouter_code_verifier',
                    sessionStorage.getItem('openrouter_code_verifier') ||
                        localStorage.getItem('openrouter_code_verifier') ||
                        ''
                );
                sessionStorage.setItem('openrouter_state', state || '');
                // Mirror to localStorage for resilience
                if (state) localStorage.setItem('openrouter_state', state);
                // Remove query params (preserve history entry) so SW matching without params works
                if (url.search) {
                    const clean = loc.origin + loc.pathname;
                    window.history.replaceState(
                        window.history.state,
                        '',
                        clean
                    );
                }
            }
        }
    } catch {
        // Non-fatal: capture failure only reduces resilience of auth callback; log silently
        reportError(err('ERR_INTERNAL', 'OpenRouter param capture failed'), {
            silent: true,
            tags: { domain: 'auth', stage: 'capture' },
        });
    }
});
