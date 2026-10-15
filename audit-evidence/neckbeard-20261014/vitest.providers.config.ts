import { resolve } from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vitest.config';

// Qualify the coordinated provider change without modifying shared dependencies
// or pretending an older published provider implements the new atomic contract.
const source = process.env.OR3_SQLITE_PROVIDER_SOURCE;
if (!source) throw new Error('Set OR3_SQLITE_PROVIDER_SOURCE to the candidate SQLite webhook store source');
export default mergeConfig(base, defineConfig({ resolve: { alias: {
    'or3-provider-sqlite/webhooks/sqlite-store': resolve(source),
} } }));
