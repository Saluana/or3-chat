import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginDevEnvironment } from '../cli/dev-plugin';

/**
 * The plugin-dev launcher pins the dedicated instance to local backing
 * services. An explicit operator override is preserved (and then reported
 * ineligible by the admission gate) rather than silently shared.
 */

const ENV_KEYS = [
    'OR3_PLUGIN_DEVELOPMENT',
    'OR3_PLUGIN_DEV_PROFILE',
    'OR3_EXTENSIONS_ROOT',
    'OR3_SQLITE_DB_PATH',
    'OR3_BASIC_AUTH_DB_PATH',
    'OR3_AUTH_PROVIDER',
    'AUTH_PROVIDER',
    'OR3_SYNC_PROVIDER',
    'NUXT_PUBLIC_STORAGE_PROVIDER',
    'OR3_STORAGE_FS_ROOT',
] as const;

const saved = new Map<string, string | undefined>();
const temporaries: string[] = [];

beforeEach(() => {
    saved.clear();
    for (const key of ENV_KEYS) {
        saved.set(key, process.env[key]);
        delete process.env[key];
    }
});

afterEach(async () => {
    for (const key of ENV_KEYS) {
        const value = saved.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    await Promise.all(temporaries.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('pluginDevEnvironment', () => {
    it('points every backing store inside the profile with local providers', async () => {
        const root = await mkdtemp(join(tmpdir(), 'or3-dev-plugin-'));
        temporaries.push(root);
        const env = pluginDevEnvironment(root);
        const profile = join(root, '.or3-plugin-dev');
        expect(env.OR3_PLUGIN_DEV_PROFILE).toBe(profile);
        expect(env.OR3_EXTENSIONS_ROOT).toBe(join(profile, 'extensions'));
        expect(env.OR3_SQLITE_DB_PATH).toBe(join(profile, 'sqlite', 'or3-sync.sqlite'));
        expect(env.OR3_BASIC_AUTH_DB_PATH).toBe(join(profile, 'auth', 'or3-basic-auth.sqlite'));
        expect(env.OR3_STORAGE_FS_ROOT).toBe(join(profile, 'storage'));
        expect(env.OR3_AUTH_PROVIDER).toBe('basic-auth');
        expect(env.OR3_SYNC_PROVIDER).toBe('sqlite');
        expect(env.NUXT_PUBLIC_STORAGE_PROVIDER).toBe('fs');
    });

    it('preserves an explicit operator override for the gate to refuse', async () => {
        const root = await mkdtemp(join(tmpdir(), 'or3-dev-plugin-'));
        temporaries.push(root);
        process.env.OR3_SYNC_PROVIDER = 'convex';
        process.env.OR3_STORAGE_FS_ROOT = '/data/shared/storage';
        const env = pluginDevEnvironment(root);
        expect(env.OR3_SYNC_PROVIDER).toBe('convex');
        expect(env.OR3_STORAGE_FS_ROOT).toBe('/data/shared/storage');
        // Untouched selections still default to the local profile.
        expect(env.OR3_AUTH_PROVIDER).toBe('basic-auth');
    });
});
