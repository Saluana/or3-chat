/**
 * @module server/api/coingecko/price.get
 *
 * Purpose:
 * Proxy for CoinGecko API to retrive crypto prices.
 *
 * Responsibilities:
 * - Caches responses to reduce upstream API calls (30s TTL).
 * - Implements a "simulated" price fallback when API rate limits (429) are hit.
 * - Handles simple CORS proxying.
 */
import { defineEventHandler, getQuery, setResponseStatus, setHeader } from 'h3';

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';
const CACHE_TTL_MS = 30 * 1000;

type CachedEntry = {
    value: Record<string, Record<string, number>>;
    storedAt: number;
    simulated?: boolean;
};

const cache = new Map<string, CachedEntry>();
const inflight = new Map<string, Promise<CachedEntry>>();

function isFresh(entry: CachedEntry): boolean {
    return Date.now() - entry.storedAt < CACHE_TTL_MS;
}

function buildCacheKey(ids: string, vsCurrencies: string): string {
    return `${ids}|${vsCurrencies}`;
}

/**
 * Generates deterministic fake price data seeded by hour + currency pair.
 * Used when CoinGecko throttles us (which is frequent on the free tier).
 */
function simulatedPrice(
    coinId: string,
    vsCurrency: string
): number {
    const staticMap: Record<string, number> = {
        bitcoin: 68000,
        ethereum: 3700,
        zcash: 30,
    };
    const base = staticMap[coinId] ?? 100;
    const hourSeed = Math.floor(Date.now() / (60 * 60 * 1000));
    const hash = Array.from(`${coinId}:${vsCurrency}:${hourSeed}`).reduce(
        (acc, ch) => acc + ch.charCodeAt(0),
        0
    );
    const jitter = (hash % 2000) / 100; // 0 - 20
    return Number((base + jitter).toFixed(2));
}

/**
 * GET /api/coingecko/price
 *
 * Purpose:
 * Fetch current prices for crypto assets.
 *
 * Behavior:
 * 1. Checks memory cache.
 * 2. If miss, calls CoinGecko.
 * 3. If CoinGecko 429s, falls back to simulated data or stale cache.
 *
 * Query Params:
 * - `ids`: Comma-separated coin IDs (e.g. bitcoin,ethereum).
 * - `vs_currencies`: Comma-separated currencies (e.g. usd,eur).
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const ids = typeof query.ids === 'string' ? query.ids.trim() : '';
    const vsCurrencies =
        typeof query.vs_currencies === 'string'
            ? query.vs_currencies.trim()
            : '';

    if (!ids || !vsCurrencies) {
        setResponseStatus(event, 400);
        return { error: 'Missing ids or vs_currencies query params.' };
    }

    const cacheKey = buildCacheKey(ids, vsCurrencies);
    const cached = cache.get(cacheKey);

    if (cached && isFresh(cached)) {
        setHeader(event, 'X-Or3-Cache', cached.simulated ? 'simulated' : 'hit');
        setHeader(event, 'Content-Type', 'application/json');
        return cached.value;
    }

    const existing = inflight.get(cacheKey);
    if (existing) {
        const entry = await existing;
        setHeader(event, 'X-Or3-Cache', 'inflight');
        setHeader(event, 'Content-Type', 'application/json');
        return entry.value;
    }

    const fetchPromise = (async (): Promise<CachedEntry> => {
        const url = new URL(COINGECKO_URL);
        url.searchParams.set('ids', ids);
        url.searchParams.set('vs_currencies', vsCurrencies);

        const response = await fetch(url.toString(), {
            headers: { accept: 'application/json' },
        });

        if (response.ok) {
            const data = (await response.json()) as Record<
                string,
                Record<string, number>
            >;
            const entry = { value: data, storedAt: Date.now() };
            cache.set(cacheKey, entry);
            return entry;
        }

        const text = await response.text().catch(() => '');

        if (response.status === 429) {
            if (cached) {
                return cached;
            }

            const idsList = ids.split(',').map((id) => id.trim());
            const vsList = vsCurrencies.split(',').map((id) => id.trim());
            const simulated: Record<string, Record<string, number>> = {};

            for (const coinId of idsList) {
                if (!coinId) continue;
                simulated[coinId] = {};
                for (const vs of vsList) {
                    if (!vs) continue;
                    simulated[coinId][vs] = simulatedPrice(coinId, vs);
                }
            }

            const entry = {
                value: simulated,
                storedAt: Date.now(),
                simulated: true,
            };
            cache.set(cacheKey, entry);
            return entry;
        }

        throw new Error(
            `CoinGecko request failed: ${response.status} ${response.statusText} ${text.slice(
                0,
                200
            )}`
        );
    })();

    inflight.set(cacheKey, fetchPromise);

    try {
        const entry = await fetchPromise;
        const cacheStatus = entry.simulated
            ? 'simulated'
            : cached
            ? 'stale'
            : 'miss';
        setHeader(event, 'X-Or3-Cache', cacheStatus);
        setHeader(event, 'Content-Type', 'application/json');
        return entry.value;
    } catch (err) {
        if (cached) {
            setHeader(
                event,
                'X-Or3-Cache',
                cached.simulated ? 'simulated' : 'stale'
            );
            setHeader(event, 'Content-Type', 'application/json');
            return cached.value;
        }

        setResponseStatus(event, 502);
        return {
            error: 'Failed to reach CoinGecko',
            message: err instanceof Error ? err.message : String(err),
        };
    } finally {
        inflight.delete(cacheKey);
    }
});
