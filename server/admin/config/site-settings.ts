import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { createError } from 'h3';
import type { RuntimeConfig } from 'nuxt/schema';
import { z } from 'zod';
import { siteSettingKeys, siteSettingPaths, type SiteSettingKey } from '../../../shared/admin/configuration';
import { GENERATED_THEME_METADATA } from '../../../app/theme/_shared/theme-manifest.generated';
import { resolveAdminDataDir } from '../auth/data-paths';
import { getConfigMetadata } from './config-metadata';
import { buildPluginSettingDefaults } from './plugin-setting-defaults';
import { AdvisoryPluginOperationLock, PackageOperationLockError } from '../plugins/package-operation-lock';

export const siteThemes = GENERATED_THEME_METADATA.map(theme => ({ value: theme.name, label: theme.displayName ?? theme.name }));
const settingsPath = () => join(resolveAdminDataDir(), 'site-settings.json');
const revision = (content: string) => createHash('sha256').update(content).digest('hex');

export async function readSiteSettings() {
    const content = await readFile(settingsPath(), 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '';
        throw error;
    });
    const values: Record<string, string> = content ? z.record(z.string(), z.string()).parse(JSON.parse(content)) : {};
    // A later build can remove previously saved themes. Fall back to the build
    // default and discard obsolete hidden IDs so every route, including Admin,
    // remains available. New selections are still validated strictly on save.
    if (values.OR3_DEFAULT_THEME !== undefined && !siteThemes.some(theme => theme.value === values.OR3_DEFAULT_THEME)) {
        delete values.OR3_DEFAULT_THEME;
    }
    if (values.OR3_DISABLED_THEMES !== undefined) {
        values.OR3_DISABLED_THEMES = values.OR3_DISABLED_THEMES.split(',')
            .map(name => name.trim())
            .filter(name => siteThemes.some(theme => theme.value === name))
            .join(',');
    }
    return { values, revision: revision(content) };
}

function invalid(key: string, message: string): never {
    throw createError({ statusCode: 400, statusMessage: message, data: { code: 'invalid_setting', key } });
}
function parseValue(key: SiteSettingKey, raw: string) {
    const value = raw.trim();
    const metadata = getConfigMetadata(key)!;
    if (metadata.valueType === 'boolean') {
        if (value !== 'true' && value !== 'false') invalid(key, `${metadata.label}: choose Enabled or Disabled.`);
        return value === 'true';
    }
    if (metadata.valueType === 'number') {
        const maximum = key === 'OR3_DEFAULT_PANE_COUNT' ? 4 : 8;
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum) invalid(key, `${metadata.label}: enter a whole number from 1 to ${maximum}.`);
        return Number(value);
    }
    if (key === 'OR3_SITE_NAME' && (!value || value.length > 80)) invalid(key, 'Site Name: enter a name with 1 to 80 characters.');
    if (key === 'OR3_DEFAULT_THEME' && !siteThemes.some(theme => theme.value === value)) invalid(key, 'Choose a site default from the available themes.');
    if (key === 'OR3_DISABLED_THEMES') {
        const names = [...new Set(value.split(',').map(name => name.trim()).filter(Boolean))];
        if (names.some(name => !siteThemes.some(theme => theme.value === name))) invalid(key, 'Hidden themes: choose from the available themes.');
        return names;
    }
    if (key.endsWith('_URL') && value) {
        const relative = value.startsWith('/') && !value.startsWith('//') && !value.includes('\\');
        let absolute = false;
        try { const url = new URL(value); absolute = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { /* A site-relative path is also allowed. */ }
        if ((!relative && !absolute) || /[\s\u0000-\u001f\u007f]/.test(value)) invalid(key, `${metadata.label}: use an http:// or https:// link, or a path starting with /.`);
    }
    return value;
}

function readPath(config: RuntimeConfig['public'], path: readonly string[]): unknown {
    return path.reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], config);
}
function writePath(config: RuntimeConfig['public'], path: readonly string[], value: unknown) {
    const parent = readPath(config, path.slice(0, -1)) as Record<string, unknown>;
    parent[path.at(-1)!] = value;
}

export function siteSettingValues(config: RuntimeConfig): Record<string, string> {
    return Object.fromEntries(Object.entries(siteSettingPaths).map(([key, path]) => {
        const value = readPath(config.public, path);
        return [key, Array.isArray(value) ? value.join(',') : String(value ?? '')];
    }));
}

/** Request-scoped config only: never mutate Nitro's frozen global defaults. */
export function applySiteSettings(config: RuntimeConfig, values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) {
        if (siteSettingKeys.has(key)) writePath(config.public, siteSettingPaths[key as SiteSettingKey], parseValue(key as SiteSettingKey, value));
    }
    const { site, legal } = config.public.or3;
    Object.assign(config.public.branding, { appName: site.name, logoUrl: site.logoUrl, defaultTheme: site.defaultTheme, disabledThemes: site.disabledThemes });
    Object.assign(config.public.legal, legal);
    Object.assign(config.public.pluginSettingDefaults, buildPluginSettingDefaults(config.public.features.workflows));
}

/** Atomic, owner-only file in the persistent admin directory. CAS spans processes. */
export async function saveSiteSettings(config: RuntimeConfig, updates: Array<{key: string; value: string | null}>, expectedRevision: string) {
    await mkdir(resolveAdminDataDir(), { recursive: true, mode: 0o700 });
    const path = settingsPath();
    // Keep the existing lock path so old, empty crash leftovers are recoverable.
    // Dead local owners are reclaimed; live writers and unknown remote owners
    // are never displaced merely because a save is taking longer than expected.
    const lease = await new AdvisoryPluginOperationLock(resolveAdminDataDir(), hostname(), true)
        .acquire('site-settings.json', { timeoutMs: 0, requireDeadOwner: true })
        .catch(error => {
            if (error instanceof PackageOperationLockError && error.code === 'lock-timeout') {
                throw createError({ statusCode: 409, statusMessage: 'Another save is in progress. Try again.', data: { code: 'settings_busy' } });
            }
            throw error;
        });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        const current = await readSiteSettings();
        if (current.revision !== expectedRevision) throw createError({ statusCode: 409, statusMessage: 'Settings changed in another tab. Reload the saved settings and try again.', data: { code: 'stale_revision' } });
        const values = { ...siteSettingValues(config), ...current.values };
        const changes: Record<string, string> = {};
        for (const { key, value } of updates) {
            if (!siteSettingKeys.has(key)) invalid(key, 'This setting cannot be changed here.');
            const parsed = parseValue(key as SiteSettingKey, value ?? '');
            changes[key] = Array.isArray(parsed) ? parsed.join(',') : String(parsed);
            values[key] = changes[key]!;
        }
        if (Number(values.OR3_DEFAULT_PANE_COUNT) > Number(values.OR3_MAX_PANES)) invalid('OR3_DEFAULT_PANE_COUNT', 'Starting chat panels cannot exceed Maximum chat panels.');
        if (values.OR3_DISABLED_THEMES?.split(',').includes(values.OR3_DEFAULT_THEME!)) invalid('OR3_DISABLED_THEMES', 'The site default theme cannot also be hidden. Choose another default first.');
        const content = JSON.stringify({ ...current.values, ...changes }, null, 2) + '\n';
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
        await rename(temporary, path);
        const directory = await open(resolveAdminDataDir(), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
        return { ok: true, restartRequired: false, savedRevision: revision(content) };
    } finally {
        try { await rm(temporary, { force: true }); }
        finally { await lease.release(); }
    }
}
