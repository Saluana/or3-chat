import { DEFAULT_OPENROUTER_BASE_URL } from '../config/constants';

export function normalizeOpenRouterBaseUrl(url: unknown): string {
    if (typeof url !== 'string') {
        return DEFAULT_OPENROUTER_BASE_URL;
    }
    const trimmed = url.trim();
    if (!trimmed) {
        return DEFAULT_OPENROUTER_BASE_URL;
    }
    try {
        const parsed = new URL(trimmed);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');
        parsed.pathname = normalizedPath || '/';
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return DEFAULT_OPENROUTER_BASE_URL;
    }
}

export function getOpenRouterChatCompletionsUrl(baseUrl: unknown): string {
    return `${normalizeOpenRouterBaseUrl(baseUrl)}/chat/completions`;
}

