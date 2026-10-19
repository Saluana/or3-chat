import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeConfig } from 'nuxt/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySiteSettings, readSiteSettings, saveSiteSettings } from '../site-settings';
import { AdvisoryPluginOperationLock } from '../../plugins/package-operation-lock';

function runtimeConfig(): RuntimeConfig {
    return {
        public: {
            or3: {
                site: { name: 'Test Chat', description: '', logoUrl: '', faviconUrl: '', defaultTheme: 'blank', disabledThemes: [] },
                ui: { defaultPaneCount: 1, maxPanes: 4, sidebarCollapsedByDefault: false },
                legal: { termsUrl: '', privacyUrl: '' },
            },
            features: {
                workflows: { enabled: true, editor: true, slashCommands: true, execution: true },
                documents: { enabled: true }, backup: { enabled: true },
                mentions: { enabled: true, documents: true, conversations: true },
                dashboard: { enabled: true },
            },
            branding: {}, legal: {}, pluginSettingDefaults: {},
        },
    } as unknown as RuntimeConfig;
}

describe('persistent site settings', () => {
    let directory: string;
    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'or3-site-settings-'));
        vi.stubEnv('OR3_ADMIN_DATA_DIR', directory);
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(directory, { recursive: true, force: true });
    });

    it('loads and repairs settings after previously installed themes are removed', async () => {
        const path = join(directory, 'site-settings.json');
        await writeFile(path, JSON.stringify({
            OR3_SITE_NAME: 'Saved Chat', OR3_DEFAULT_THEME: 'removed-theme',
            OR3_DISABLED_THEMES: 'removed-theme,retro',
        }));
        const saved = await readSiteSettings();
        const config = runtimeConfig();
        applySiteSettings(config, saved.values);

        expect(config.public.or3.site).toMatchObject({ name: 'Saved Chat', defaultTheme: 'blank', disabledThemes: ['retro'] });
        expect(saved.values.OR3_DEFAULT_THEME).toBeUndefined();
        await saveSiteSettings(config, [{ key: 'OR3_SITE_NAME', value: 'Repaired Chat' }], saved.revision);
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ OR3_SITE_NAME: 'Repaired Chat', OR3_DISABLED_THEMES: 'retro' });
    });

    it('still rejects new unavailable theme selections without partially saving', async () => {
        const initial = await readSiteSettings();
        for (const key of ['OR3_DEFAULT_THEME', 'OR3_DISABLED_THEMES']) {
            await expect(saveSiteSettings(runtimeConfig(), [
                { key: 'OR3_SITE_NAME', value: 'Must not save' },
                { key, value: 'unavailable-theme' },
            ], initial.revision)).rejects.toMatchObject({ statusCode: 400 });
        }
        expect(await readSiteSettings()).toEqual(initial);
    });

    it.each(['dead-owner', 'legacy-empty'])('saves after an abandoned %s lock', async kind => {
        const lock = join(directory, 'site-settings.json.lock');
        await mkdir(lock);
        if (kind === 'dead-owner') {
            await writeFile(join(lock, 'owner.json'), JSON.stringify({
                schemaVersion: 1, pluginId: 'site-settings.json', ownerId: 'interrupted-save',
                pid: 2_147_483_647, hostname: hostname(), acquiredAt: 1, heartbeatAt: 1,
            }));
        } else {
            await utimes(lock, new Date(0), new Date(0));
        }
        const initial = await readSiteSettings();
        await expect(saveSiteSettings(runtimeConfig(), [{ key: 'OR3_SITE_NAME', value: 'Recovered Chat' }], initial.revision)).resolves.toMatchObject({ ok: true });
        expect((await readSiteSettings()).values.OR3_SITE_NAME).toBe('Recovered Chat');
    });

    it('preserves an active writer and rejects stale revisions after it finishes', async () => {
        const lease = await new AdvisoryPluginOperationLock(directory, hostname(), true).acquire('site-settings.json');
        const initial = await readSiteSettings();
        const updates = [{ key: 'OR3_SITE_NAME', value: 'First writer' }];
        try {
            await expect(saveSiteSettings(runtimeConfig(), updates, initial.revision)).rejects.toMatchObject({ statusCode: 409, data: { code: 'settings_busy' } });
            expect(await readSiteSettings()).toEqual(initial);
        } finally {
            await lease.release();
        }
        await saveSiteSettings(runtimeConfig(), updates, initial.revision);
        await expect(saveSiteSettings(runtimeConfig(), [{ key: 'OR3_SITE_NAME', value: 'Stale writer' }], initial.revision)).rejects.toMatchObject({ statusCode: 409, data: { code: 'stale_revision' } });
        expect((await readSiteSettings()).values.OR3_SITE_NAME).toBe('First writer');
    });
});
