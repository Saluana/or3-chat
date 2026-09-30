import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireProfile, pluginDevEnvironment, pluginDevProfile } from '../cli/dev-plugin';

/**
 * The plugin-dev launcher pins the dedicated instance to local backing
 * services. An explicit operator override is preserved (and then reported
 * ineligible by the admission gate) rather than silently shared.
 */

const ENV_KEYS = [
    'OR3_PLUGIN_DEVELOPMENT',
    'OR3_PLUGIN_DEV_PROFILE',
    'OR3_PLUGIN_DEV_COOKIE_SCOPE',
    'OR3_EXTENSIONS_ROOT',
    'OR3_SQLITE_DB_PATH',
    'OR3_BASIC_AUTH_DB_PATH',
    'OR3_AUTH_PROVIDER',
    'AUTH_PROVIDER',
    'OR3_SYNC_PROVIDER',
    'NUXT_PUBLIC_STORAGE_PROVIDER',
    'OR3_STORAGE_FS_ROOT', 'OR3_STORAGE_FS_TOKEN_SECRET',
    'OR3_ADMIN_DATA_DIR', 'OR3_ADMIN_PASSWORD', 'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL',
    'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD', 'OR3_BASIC_AUTH_JWT_SECRET',
    'OR3_BASIC_AUTH_REFRESH_SECRET', 'OR3_AUTH_REGISTRATION_MODE',
    'OR3_PLUGIN_MODULE_LOADER_V2_ENABLED',
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

describe('watched profile ownership', () => {
    it('rejects a second owner and recovers abandoned ownership without deleting data', async () => {
        const root = await mkdtemp(join(tmpdir(), 'or3-dev-plugin-lock-'));
        temporaries.push(root);
        const release = acquireProfile(root);
        expect(() => acquireProfile(root)).toThrow('already in use');
        release();
        await writeFile(join(root, 'launcher.lock'), '2147483647\n');
        await writeFile(join(root, 'keep.txt'), 'plugin data');
        const recovered = acquireProfile(root);
        expect(await readFile(join(root, 'launcher.lock'), 'utf8')).toBe(`${process.pid}\n`);
        expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('plugin data');
        recovered();
    });
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

    it('isolates watched plugins and reuses restrictive local credentials', async () => {
        const root = await mkdtemp(join(tmpdir(), 'or3-dev-plugin-'));
        temporaries.push(root);
        const firstPlugin = join(root, 'first');
        const secondPlugin = join(root, 'second');
        await mkdir(firstPlugin);
        await mkdir(secondPlugin);
        const profile = pluginDevProfile(root, firstPlugin);
        expect(profile).not.toBe(pluginDevProfile(root, secondPlugin));
        const env = pluginDevEnvironment(root, firstPlugin);
        expect(env.OR3_PLUGIN_DEV_PROFILE).toBe(profile);
        expect(env.OR3_PLUGIN_DEV_COOKIE_SCOPE).toMatch(/^[a-f0-9]{16}$/);
        expect(env.OR3_PLUGIN_DEV_COOKIE_SCOPE).not.toBe(pluginDevEnvironment(root, secondPlugin).OR3_PLUGIN_DEV_COOKIE_SCOPE);
        expect(env.OR3_PLUGIN_WATCH_ROOT).toBe(await realpath(firstPlugin));
        expect(env.OR3_EXTENSIONS_ROOT).toBe(join(profile, 'extensions'));
        expect(env.OR3_SQLITE_DB_PATH).toBe(join(profile, 'sqlite', 'or3-sync.sqlite'));
        expect(env.OR3_BASIC_AUTH_DB_PATH).toBe(join(profile, 'auth', 'or3-basic-auth.sqlite'));
        expect(env.OR3_STORAGE_FS_ROOT).toBe(join(profile, 'storage'));
        expect(env.OR3_ADMIN_DATA_DIR).toBe(join(profile, 'admin'));
        expect(env.OR3_AUTH_PROVIDER).toBe('basic-auth');
        expect(env.OR3_SYNC_PROVIDER).toBe('sqlite');
        expect(env.NUXT_PUBLIC_STORAGE_PROVIDER).toBe('fs');
        expect(env.OR3_AUTH_REGISTRATION_MODE).toBe('invite_only');
        expect(env.OR3_PLUGIN_MODULE_LOADER_V2_ENABLED).toBe('true');
        expect(env.OR3_LOCAL_PROVIDERS).toBe('true');
        expect(env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD).toBe(env.OR3_ADMIN_PASSWORD);
        for (const key of ['password', 'basic-auth-jwt-secret', 'basic-auth-refresh-secret', 'fs-token-secret']) {
            expect((await stat(join(profile, key))).mode & 0o777).toBe(0o600);
        }
        expect(pluginDevEnvironment(root, firstPlugin).OR3_ADMIN_PASSWORD).toBe(env.OR3_ADMIN_PASSWORD);
    });

    it('rejects watched profile overrides before the host starts', async () => {
        const root = await mkdtemp(join(tmpdir(), 'or3-dev-plugin-'));
        temporaries.push(root);
        const plugin = join(root, 'plugin');
        await mkdir(plugin);
        process.env.OR3_STORAGE_FS_ROOT = join(root, 'shared');
        expect(() => pluginDevEnvironment(root, plugin)).toThrow('OR3_STORAGE_FS_ROOT');
        delete process.env.OR3_STORAGE_FS_ROOT;
        process.env.OR3_SYNC_PROVIDER = 'convex';
        expect(() => pluginDevEnvironment(root, plugin)).toThrow('OR3_SYNC_PROVIDER');
    });
});
