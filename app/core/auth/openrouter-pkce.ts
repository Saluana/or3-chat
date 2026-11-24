/** One tab owns each new PKCE attempt; legacy storage is read only. */
const ATTEMPT_KEY = 'openrouter_code_verifier';
const LEGACY_KEYS = ['openrouter_auth_code', 'openrouter_code_verifier', 'openrouter_state', 'openrouter_code_method'] as const;

export interface OpenRouterPkceAttempt {
    version: 1;
    verifier: string;
    state: string;
    method: 'S256' | 'plain';
    consumed?: boolean;
    callback?: { code: string; state: string };
}

function readAttempt(storage: Storage): OpenRouterPkceAttempt | null {
    const raw = storage.getItem(ATTEMPT_KEY);
    if (raw?.startsWith('{')) {
        try {
            const value: unknown = JSON.parse(raw);
            if (!value || typeof value !== 'object') return null;
            const record = value as Partial<OpenRouterPkceAttempt>;
            if (record.version !== 1 || typeof record.verifier !== 'string' || !record.verifier ||
                typeof record.state !== 'string' || !record.state ||
                (record.method !== 'S256' && record.method !== 'plain')) return null;
            const callback = record.callback;
            return { version: 1, verifier: record.verifier, state: record.state, method: record.method,
                consumed: record.consumed === true,
                ...(callback && typeof callback.code === 'string' && callback.code && callback.state === record.state
                    ? { callback: { code: callback.code, state: callback.state } } : {}),
            };
        } catch { return null; }
    }
    const state = storage.getItem('openrouter_state');
    if (!raw || !state) return null;
    return { version: 1, verifier: raw, state, method: storage.getItem('openrouter_code_method') === 'plain' ? 'plain' : 'S256' };
}

/** An inaccessible tab store cannot establish which attempt belongs to this tab. */
export function readOpenRouterPkceAttempt(): OpenRouterPkceAttempt | null {
    try {
        const storage = sessionStorage;
        const raw = storage.getItem(ATTEMPT_KEY);
        const state = storage.getItem('openrouter_state');
        if (raw !== null || state !== null) return readAttempt(storage);
    } catch { return null; }
    try { return readAttempt(localStorage); }
    catch { return null; }
}

export function storeOpenRouterPkceAttempt(attempt: OpenRouterPkceAttempt): void {
    const encoded = JSON.stringify(attempt);
    const storage = sessionStorage;
    storage.setItem(ATTEMPT_KEY, encoded);
    if (storage.getItem(ATTEMPT_KEY) !== encoded) throw new Error('Browser storage is unavailable');
}

/** Capture returned parameters without replacing the independently saved state. */
export function captureOpenRouterCallback(code: string | null, state: string | null): boolean {
    const attempt = readOpenRouterPkceAttempt();
    if (!attempt || attempt.consumed || !code || state !== attempt.state) return false;
    try {
        storeOpenRouterPkceAttempt({ ...attempt, callback: { code, state } });
        return true;
    } catch { return false; }
}

export function isCurrentOpenRouterPkceAttempt(attempt: OpenRouterPkceAttempt): boolean {
    try {
        const current = readAttempt(sessionStorage);
        return current?.state === attempt.state && current.verifier === attempt.verifier;
    } catch { return false; }
}

/** Mark before exchange, so failed cleanup cannot replay a single-use code. */
export function consumeOpenRouterPkceAttempt(attempt: OpenRouterPkceAttempt): boolean {
    const current = readOpenRouterPkceAttempt();
    if (current?.state !== attempt.state || current.verifier !== attempt.verifier || current.consumed || attempt.consumed) return false;
    try {
        storeOpenRouterPkceAttempt({ ...attempt, callback: undefined, consumed: true });
        return true;
    } catch { return false; }
}

/** An old callback must not clear a newer tab attempt or another tab's legacy flow. */
export function clearOpenRouterPkceAttempt(expectedState?: string): void {
    try {
        const storage = sessionStorage;
        const current = readAttempt(storage);
        if (expectedState === undefined || current?.state === expectedState) {
            for (const key of LEGACY_KEYS) {
                try { storage.removeItem(key); } catch { /* Cleanup must not hide an exchange result. */ }
            }
        }
    } catch { /* Tab storage can be denied even when accessing its getter. */ }
    if (!expectedState) return;
    try {
        const storage = localStorage;
        if (storage.getItem('openrouter_state') !== expectedState) return;
        for (const key of LEGACY_KEYS) {
            try { storage.removeItem(key); } catch { /* Legacy cleanup is best effort. */ }
        }
    } catch { /* No new attempt depends on localStorage. */ }
}
