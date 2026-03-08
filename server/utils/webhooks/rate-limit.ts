type WebhookRateLimitEntry = {
    count: number;
    resetAt: number;
};

export interface WebhookRateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const store = new Map<string, WebhookRateLimitEntry>();

export function checkWebhookRateLimit(
    webhookId: string,
    limitPerMinute: number,
    now = Date.now()
): WebhookRateLimitResult {
    const max = Math.max(1, Math.floor(limitPerMinute));
    const current = store.get(webhookId);

    if (!current || now >= current.resetAt) {
        const next: WebhookRateLimitEntry = {
            count: 1,
            resetAt: now + DEFAULT_WINDOW_MS,
        };
        store.set(webhookId, next);
        return {
            allowed: true,
            remaining: Math.max(0, max - next.count),
            resetAt: next.resetAt,
        };
    }

    if (current.count >= max) {
        return {
            allowed: false,
            remaining: 0,
            resetAt: current.resetAt,
        };
    }

    current.count += 1;
    return {
        allowed: true,
        remaining: Math.max(0, max - current.count),
        resetAt: current.resetAt,
    };
}

export function resetWebhookRateLimits(webhookId?: string): void {
    if (webhookId) {
        store.delete(webhookId);
        return;
    }

    store.clear();
}
