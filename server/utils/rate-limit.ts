/**
 * Simple in-memory rate limiter for admin endpoints.
 * Uses sliding window algorithm. Not distributed - for single-instance use.
 */

type RateLimitEntry = {
    count: number;
    resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

export type RateLimitOptions = {
    max: number;      // Maximum requests allowed
    window: number;   // Window in seconds
};

/**
 * Check if request is within rate limit.
 * @param key - Unique identifier (e.g., IP + endpoint)
 * @param options - Rate limit configuration
 * @returns true if allowed, false if exceeded
 */
export async function checkRateLimit(
    key: string,
    options: RateLimitOptions
): Promise<boolean> {
    const now = Date.now();
    const windowMs = options.window * 1000;
    
    const entry = store.get(key);
    
    if (!entry || now > entry.resetAt) {
        // New window
        store.set(key, {
            count: 1,
            resetAt: now + windowMs,
        });
        return true;
    }
    
    if (entry.count >= options.max) {
        return false;
    }
    
    entry.count++;
    return true;
}

/**
 * Get remaining requests and reset time for a key.
 */
export function getRateLimitStatus(key: string): { remaining: number; resetAt: number } | null {
    const entry = store.get(key);
    if (!entry) return null;
    
    return {
        remaining: Math.max(0, entry.count),
        resetAt: entry.resetAt,
    };
}

// Cleanup old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        if (now > entry.resetAt) {
            store.delete(key);
        }
    }
}, 5 * 60 * 1000);
