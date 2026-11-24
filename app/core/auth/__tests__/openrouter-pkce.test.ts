import { afterEach, expect, it } from 'vitest';
import { consumeOpenRouterPkceAttempt, storeOpenRouterPkceAttempt } from '../openrouter-pkce';

afterEach(() => sessionStorage.clear());

it('refuses a second exchange admission from the original pre-consumption snapshot', () => {
    const snapshot = { version: 1, verifier: 'verifier', state: 'state', method: 'S256' } as const;
    storeOpenRouterPkceAttempt(snapshot);

    expect(consumeOpenRouterPkceAttempt(snapshot)).toBe(true);
    expect(consumeOpenRouterPkceAttempt(snapshot)).toBe(false);
});
