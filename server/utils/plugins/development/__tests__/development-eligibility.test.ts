import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { H3Event } from 'h3';
import {
    developmentIneligibilityHelp,
    resolvePluginDevelopmentEligibility,
} from '../development-eligibility';

/**
 * Each admission restriction fails independently: no single flag, header or
 * URL can enable the development path on its own, and a production build
 * rejects it regardless of configuration.
 */

const ENV_KEYS = [
    'OR3_PLUGIN_DEVELOPMENT',
    'OR3_PLUGIN_DEV_PROFILE',
    'OR3_EXTENSIONS_ROOT',
    'OR3_SQLITE_DB_PATH',
    'OR3_BASIC_AUTH_DB_PATH',
] as const;

const saved = new Map<string, string | undefined>();
const profiles: string[] = [];

function loopbackEvent(remoteAddress = '127.0.0.1', headers: Record<string, string> = {}): H3Event {
    return {
        node: { req: { socket: { remoteAddress }, headers } },
    } as unknown as H3Event;
}

/** Development stacks that proxy API requests expose no socket identity. */
function proxiedEvent(headers: Record<string, string> = {}): H3Event {
    return {
        node: { req: { socket: {}, headers: { host: '127.0.0.1:3101', ...headers } } },
    } as unknown as H3Event;
}

function eligibleEnv(): void {
    process.env.OR3_PLUGIN_DEVELOPMENT = '1';
    process.env.OR3_PLUGIN_DEV_PROFILE = '/tmp/or3-dev-profile';
    process.env.OR3_EXTENSIONS_ROOT = '/tmp/or3-dev-profile/extensions';
    process.env.OR3_SQLITE_DB_PATH = '/tmp/or3-dev-profile/sqlite/or3-sync.sqlite';
    process.env.OR3_BASIC_AUTH_DB_PATH = '/tmp/or3-dev-profile/auth/or3-basic-auth.sqlite';
}

beforeEach(() => {
    saved.clear();
    for (const key of ENV_KEYS) {
        saved.set(key, process.env[key]);
        delete process.env[key];
    }
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        const value = saved.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    for (const profile of profiles.splice(0)) rmSync(profile, { recursive: true, force: true });
    vi.unstubAllEnvs();
});

describe('development eligibility', () => {
    // Vitest has no dev build (`import.meta.dev` is undefined there), so the
    // eligible cases simulate one explicitly; production code uses the default.
    const DEV_BUILD = { isDevelopmentBuild: true } as const;

    it('accepts the dedicated loopback instance with all roots inside the profile', () => {
        eligibleEnv();
        const result = resolvePluginDevelopmentEligibility(loopbackEvent(), DEV_BUILD);
        expect(result.eligible).toBe(true);
        expect(result.reasons).toEqual([]);
        expect(result.profileRoot).toBe('/tmp/or3-dev-profile');
    });

    it('rejects a production build even with the flag set', () => {
        eligibleEnv();
        const result = resolvePluginDevelopmentEligibility(loopbackEvent(), {
            isDevelopmentBuild: false,
        });
        expect(result.eligible).toBe(false);
        expect(result.reasons).toContain('production-build');
    });

    it('requires the opt-in flag', () => {
        eligibleEnv();
        delete process.env.OR3_PLUGIN_DEVELOPMENT;
        const result = resolvePluginDevelopmentEligibility(loopbackEvent(), DEV_BUILD);
        expect(result.reasons).toContain('development-flag-missing');
    });

    it('requires the dedicated profile and refuses borrowed roots', () => {
        eligibleEnv();
        delete process.env.OR3_PLUGIN_DEV_PROFILE;
        expect(
            resolvePluginDevelopmentEligibility(loopbackEvent(), DEV_BUILD).reasons
        ).toContain('dedicated-profile-missing');

        eligibleEnv();
        process.env.OR3_EXTENSIONS_ROOT = '/data/shared/extensions';
        expect(
            resolvePluginDevelopmentEligibility(loopbackEvent(), DEV_BUILD).reasons
        ).toContain('extension-root-outside-profile');

        eligibleEnv();
        process.env.OR3_SQLITE_DB_PATH = '/data/shared/or3-sync.sqlite';
        expect(
            resolvePluginDevelopmentEligibility(loopbackEvent(), DEV_BUILD).reasons
        ).toContain('data-root-outside-profile');

        eligibleEnv();
        delete process.env.OR3_BASIC_AUTH_DB_PATH;
        expect(
            resolvePluginDevelopmentEligibility(loopbackEvent(), DEV_BUILD).reasons
        ).toContain('data-root-outside-profile');
    });

    it('rejects non-loopback sockets and never trusts forwarded headers', () => {
        eligibleEnv();
        expect(
            resolvePluginDevelopmentEligibility(loopbackEvent('192.168.1.10'), DEV_BUILD).reasons
        ).toContain('non-loopback-access');
        // A loopback forwarder entry cannot rescue a non-loopback socket.
        expect(
            resolvePluginDevelopmentEligibility(
                loopbackEvent('10.0.0.5', { 'x-forwarded-for': '127.0.0.1' }),
                DEV_BUILD
            ).reasons
        ).toContain('non-loopback-access');
        // IPv6 loopback is accepted; an empty socket is not.
        expect(resolvePluginDevelopmentEligibility(loopbackEvent('::1'), DEV_BUILD).eligible).toBe(true);
        expect(
            resolvePluginDevelopmentEligibility(loopbackEvent(''), DEV_BUILD).reasons
        ).toContain('non-loopback-access');
    });

    it('falls back to the launcher bind record when the stack hides the socket', () => {
        const profile = mkdtempSync(join(tmpdir(), 'or3-dev-profile-'));
        profiles.push(profile);
        process.env.OR3_PLUGIN_DEVELOPMENT = '1';
        process.env.OR3_PLUGIN_DEV_PROFILE = profile;
        process.env.OR3_EXTENSIONS_ROOT = join(profile, 'extensions');
        process.env.OR3_SQLITE_DB_PATH = join(profile, 'sqlite', 'or3-sync.sqlite');
        process.env.OR3_BASIC_AUTH_DB_PATH = join(profile, 'auth', 'or3-basic-auth.sqlite');
        writeFileSync(join(profile, 'launcher.json'), JSON.stringify({ host: '127.0.0.1', port: '3101' }));
        // The local dev proxy inserts a single loopback forwarder entry.
        expect(
            resolvePluginDevelopmentEligibility(
                proxiedEvent({ 'x-forwarded-for': '127.0.0.1' }),
                DEV_BUILD
            ).eligible
        ).toBe(true);
        expect(
            resolvePluginDevelopmentEligibility(proxiedEvent(), DEV_BUILD).eligible
        ).toBe(true);
        // Each fallback leg fails independently.
        writeFileSync(join(profile, 'launcher.json'), JSON.stringify({ host: '0.0.0.0', port: '3101' }));
        expect(
            resolvePluginDevelopmentEligibility(
                proxiedEvent({ 'x-forwarded-for': '127.0.0.1' }),
                DEV_BUILD
            ).reasons
        ).toContain('non-loopback-access');
        writeFileSync(join(profile, 'launcher.json'), JSON.stringify({ host: '127.0.0.1', port: '3101' }));
        expect(
            resolvePluginDevelopmentEligibility(
                proxiedEvent({ host: 'example.com', 'x-forwarded-for': '127.0.0.1' }),
                DEV_BUILD
            ).reasons
        ).toContain('non-loopback-access');
        expect(
            resolvePluginDevelopmentEligibility(
                proxiedEvent({ 'x-forwarded-for': '203.0.113.7' }),
                DEV_BUILD
            ).reasons
        ).toContain('non-loopback-access');
        expect(
            resolvePluginDevelopmentEligibility(
                proxiedEvent({ 'x-forwarded-for': '127.0.0.1, 203.0.113.7' }),
                DEV_BUILD
            ).reasons
        ).toContain('non-loopback-access');
    });

    it('explains every reason without leaking configuration values', () => {
        eligibleEnv();
        const result = resolvePluginDevelopmentEligibility(loopbackEvent('8.8.8.8'), {
            isDevelopmentBuild: false,
        });
        expect(result.eligible).toBe(false);
        const help = result.reasons.map(developmentIneligibilityHelp).join(' ');
        expect(help.length).toBeGreaterThan(0);
        expect(help).not.toContain('/tmp/or3-dev-profile');
        expect(help).not.toContain('8.8.8.8');
    });
});
