import { err, reportError } from '~/utils/errors';

export interface ExchangeResultSuccess {
    ok: true;
    userKey: string;
    status: number;
}
export interface ExchangeResultFail {
    ok: false;
    status: number;
    reason: 'network' | 'bad-response' | 'no-key';
}
export type ExchangeResult = ExchangeResultSuccess | ExchangeResultFail;

export interface ExchangeParams {
    code: string;
    verifier: string;
    codeMethod: string;
    fetchImpl?: typeof fetch;
    attempt?: number;
}

export async function exchangeOpenRouterCode(
    p: ExchangeParams
): Promise<ExchangeResult> {
    const fetchFn = p.fetchImpl || fetch;
    let resp: Response;
    try {
        resp = await fetchFn('https://openrouter.ai/api/v1/auth/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: p.code,
                code_verifier: p.verifier,
                code_challenge_method: p.codeMethod,
            }),
        });
    } catch (e) {
        reportError(e, {
            code: 'ERR_NETWORK',
            tags: {
                domain: 'auth',
                stage: 'exchange',
                attempt: p.attempt || 1,
            },
            toast: true,
            retryable: true,
        });
        return { ok: false, status: 0, reason: 'network' };
    }
    interface AuthResponse {
        key?: string;
        access_token?: string;
    }
    let json: AuthResponse | null = null;
    try {
        json = await resp.json() as AuthResponse;
    } catch {
        /* ignore parse */
    }
    if (!resp.ok || !json) {
        reportError(
            err('ERR_NETWORK', 'Auth code exchange failed', {
                severity: 'error',
                tags: {
                    domain: 'auth',
                    stage: 'exchange',
                    status: resp.status,
                    attempt: p.attempt || 1,
                },
                retryable: true,
            }),
            { toast: true }
        );
        return { ok: false, status: resp.status, reason: 'bad-response' };
    }
    const userKey = json.key || json.access_token;
    if (!userKey) {
        reportError(
            err('ERR_AUTH', 'Auth exchange returned no key', {
                severity: 'error',
                tags: {
                    domain: 'auth',
                    stage: 'exchange',
                    keys: Object.keys(json).length,
                },
            }),
            { toast: true }
        );
        return { ok: false, status: resp.status, reason: 'no-key' };
    }
    return { ok: true, userKey, status: resp.status };
}
