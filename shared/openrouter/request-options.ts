// Shared request metadata stays independent of the full SDK client so model
// catalog lookups do not pull every OpenRouter API into the initial bundle.
export const DEFAULT_HEADERS = {
    'HTTP-Referer': 'https://or3.chat',
    'X-Title': 'or3.chat',
};

export function getRequestOptions(signal?: AbortSignal) {
    return {
        fetchOptions: {
            headers: DEFAULT_HEADERS,
            ...(signal && { signal }),
        },
    };
}
