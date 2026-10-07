import { readResponseTextWithIdleDeadline } from './deadlines';
import { affordableCompletionTokens } from './errors';

/** Below this, a credit-limited retry would only produce a truncated reply. */
export const MIN_AFFORDABLE_REPLY_TOKENS = 1024;

/**
 * OpenRouter reserves credit for `max_tokens` and refuses (402) a request
 * whose reservation exceeds the key's balance, naming the size it can afford.
 * When OR3 chose the allowance (`defaultAllowance`), send the request once more
 * at that size. An explicit allowance or a smaller affordable size keeps the
 * credit error; its body is returned as `errorText`, already read.
 */
export async function sendWithAffordableReply<T extends { max_tokens?: unknown }>(
    send: (body: T) => Promise<Response>,
    body: T,
    options: { defaultAllowance: boolean; signal?: AbortSignal },
): Promise<{ response: Response; body: T; errorText?: string }> {
    const response = await send(body);
    if (response.status !== 402 || !options.defaultAllowance || typeof body.max_tokens !== 'number') {
        return { response, body };
    }
    const errorText = await readResponseTextWithIdleDeadline(response, { signal: options.signal })
        .catch(() => '<error-reading-body>');
    const affordable = affordableCompletionTokens(errorText);
    if (affordable === undefined || affordable < MIN_AFFORDABLE_REPLY_TOKENS || affordable >= body.max_tokens) {
        return { response, body, errorText };
    }
    const retried = { ...body, max_tokens: affordable };
    return { response: await send(retried), body: retried };
}
