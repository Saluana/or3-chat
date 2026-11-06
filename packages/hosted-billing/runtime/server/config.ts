import { resolve } from 'node:path';

export interface BillingConfig {
    secretKey: string;
    webhookSecret: string;
    priceId: string;
    baseUrl: string;
    databasePath: string;
    syncDatabasePath: string;
}

export function readBillingConfig(env = process.env): BillingConfig {
    const secretKey = env.OR3_BILLING_STRIPE_SECRET_KEY?.trim() || '';
    const webhookSecret = env.OR3_BILLING_STRIPE_WEBHOOK_SECRET?.trim() || '';
    const priceId = env.OR3_BILLING_STRIPE_PRICE_ID?.trim() || '';
    if (!/^(?:rk|sk)_(?:test|live)_/.test(secretKey) || !webhookSecret.startsWith('whsec_') || !priceId.startsWith('price_')) {
        throw new Error('Hosted billing requires OR3_BILLING_STRIPE_SECRET_KEY, OR3_BILLING_STRIPE_WEBHOOK_SECRET and OR3_BILLING_STRIPE_PRICE_ID.');
    }
    const url = new URL(env.OR3_BILLING_BASE_URL || '');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
        throw new Error('OR3_BILLING_BASE_URL must be an HTTPS origin (HTTP localhost is allowed for testing).');
    }
    if (!env.OR3_BILLING_SQLITE_PATH?.trim()) throw new Error('Set OR3_BILLING_SQLITE_PATH to a persistent private billing database path.');
    if (!env.OR3_SQLITE_DB_PATH || env.OR3_SQLITE_DB_PATH === ':memory:' ||
        (env.OR3_SQLITE_DRIVER && !['better-sqlite3', 'node'].includes(env.OR3_SQLITE_DRIVER))) {
        throw new Error('Hosted billing requires a persistent OR3_SQLITE_DB_PATH using the better-sqlite3 driver.');
    }
    const databasePath = resolve(env.OR3_BILLING_SQLITE_PATH);
    const syncDatabasePath = resolve(env.OR3_SQLITE_DB_PATH);
    if (databasePath === syncDatabasePath) throw new Error('Use a separate billing database file; canonical sync tables remain provider-owned.');
    return { secretKey, webhookSecret, priceId, baseUrl: url.origin, databasePath, syncDatabasePath };
}
