import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { RestartController } from '../../../../shared/server/restarts/controller';
import { createRestartConfigurationSource } from '../../../../shared/server/restarts/configuration';

const fixture = vi.hoisted(() => ({ directory: '', control: null as any, supported: true, readBody: vi.fn(), authorize: vi.fn(), config: {
    auth: { registrationMode: 'open', invite: { tokenSecret: 'server-only-secret' } },
} }));
vi.mock('h3', async (importOriginal) => ({
    ...await importOriginal<typeof import('h3')>(),
    defineEventHandler: (handler: unknown) => handler,
    readBody: fixture.readBody,
    setResponseHeader: vi.fn(),
}));
vi.mock('#imports', () => ({ useRuntimeConfig: () => fixture.config }));
vi.mock('../../../admin/api', () => ({ requireAdminApiContext: fixture.authorize, requireAdminApi: fixture.authorize }));
vi.mock('../../../admin/auth/rate-limit', () => ({ enforceGenericAdminRateLimit: vi.fn() }));
vi.mock('../../../admin/system/server-control', () => ({
    hasRestartController: () => fixture.supported,
    readRestartStatus: () => fixture.control.status(),
    saveRestartConfiguration: (updates: Record<string, string | null>, revision: string) => fixture.control.save(updates, revision),
    restartControlError: (code: string, statusCode = 409) => { throw { statusCode, data: { code } }; },
}));
vi.mock('../../../admin/config/env-file', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../admin/config/env-file')>();
    return {
        ...actual,
        readEnvFile: () => actual.readEnvFile({ instanceDir: fixture.directory }),
        writeEnvFile: (updates: Record<string, string | null>) => actual.writeEnvFile(updates, { instanceDir: fixture.directory }),
    };
});

const { default: readSettings } = await import('../registration.get');
const { default: saveSettings } = await import('../registration.post');
const { default: saveConfiguration } = await import('../system/config/write.post');
async function body(mode: string) { return { mode, expectedRevision: (await fixture.control.status()).savedRevision }; }

describe('admin registration settings', () => {
    // Failure modes: mode saves affect unrelated configuration or active policy;
    // invalid modes reach disk; invite-only is enabled without working invitations;
    // saved changes disappear on reload; secrets leak; denied requests still write.
    beforeEach(async () => {
        vi.clearAllMocks();
        fixture.directory = await mkdtemp(join(tmpdir(), 'or3-registration-settings-'));
        fixture.config.auth.registrationMode = 'open';
        fixture.config.auth.invite.tokenSecret = 'server-only-secret';
        fixture.authorize.mockResolvedValue({ principal: { kind: 'super_admin' } });
        await writeFile(join(fixture.directory, '.env'), '# Preserve this setting\nOR3_SITE_NAME=MyChat\n');
        fixture.supported = true;
        const source = await createRestartConfigurationSource(join(fixture.directory, '.env'), fixture.directory,
            async () => parse(await readFile(join(fixture.directory, '.env'), 'utf8')));
        fixture.control = new RestartController(fixture.directory, { mode: 'development', identity: 'registration-fixture', ...source,
            acquire: async () => async () => {}, replace: async () => {}, probe: async () => {} });
        await fixture.control.initialize();
        await fixture.control.boot({ bootId: 'boot-1', ready: true, settings: { registrationMode: 'open', allowRestart: false } });
    });
    afterEach(async () => { fixture.control?.dispose(); await rm(fixture.directory, { recursive: true, force: true }); });

    it.each(['open', 'invite_only', 'disabled'])('persists %s without changing the active policy or unrelated values', async mode => {
        fixture.readBody.mockResolvedValue(await body(mode));
        await expect(saveSettings({} as never)).resolves.toMatchObject({ savedMode: mode, restartRequired: mode !== 'open' });
        const saved = await readSettings({} as never);
        expect(saved).toMatchObject({ currentMode: 'open', savedMode: mode, restartRequired: mode !== 'open', inviteSigningConfigured: true });
        expect(await readFile(join(fixture.directory, '.env'), 'utf8')).toContain('# Preserve this setting\nOR3_SITE_NAME=MyChat\n');
        expect(fixture.config.auth.registrationMode).toBe('open');
        expect(JSON.stringify(saved)).not.toContain('server-only-secret');
        expect(fixture.authorize).toHaveBeenCalledWith({}, { superAdminOnly: true, mutation: true });
        if (mode === 'open') {
            await fixture.control.boot({ bootId: 'boot-1', ready: true, settings: { registrationMode: 'open', allowRestart: false } });
            const noChange = await fixture.control.status();
            expect(noChange.activeRevision).toBe(noChange.savedRevision);
        }
    });

    it.each([{}, { mode: 'public' }, { mode: '' }, { mode: null }, { mode: 'open', extra: true }])('rejects invalid settings %j without writing', async body => {
        fixture.readBody.mockResolvedValue(body);
        await expect(saveSettings({} as never)).rejects.toMatchObject({ statusCode: 400 });
        expect(await readFile(join(fixture.directory, '.env'), 'utf8')).not.toContain('OR3_AUTH_REGISTRATION_MODE');
    });

    it('requires invitation setup before saving invite-only registration', async () => {
        fixture.config.auth.invite.tokenSecret = '';
        fixture.readBody.mockResolvedValue(await body('invite_only'));
        await expect(saveSettings({} as never)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Set up invitations before choosing Invite only.' });
        expect(await readSettings({} as never)).toMatchObject({ inviteSigningConfigured: false, savedMode: 'open' });
        expect(await readFile(join(fixture.directory, '.env'), 'utf8')).not.toContain('OR3_AUTH_REGISTRATION_MODE');
    });

    it('clears the restart notice after the saved mode becomes active', async () => {
        fixture.readBody.mockResolvedValue(await body('invite_only'));
        await saveSettings({} as never);
        fixture.config.auth.registrationMode = 'invite_only';
        await expect(readSettings({} as never)).resolves.toMatchObject({ currentMode: 'invite_only', savedMode: 'invite_only', restartRequired: false });
    });

    it('stops denied requests before reading or writing settings', async () => {
        fixture.authorize.mockRejectedValue({ statusCode: 403 });
        await expect(readSettings({} as never)).rejects.toMatchObject({ statusCode: 403 });
        await expect(saveSettings({} as never)).rejects.toMatchObject({ statusCode: 403 });
        expect(fixture.readBody).not.toHaveBeenCalled();
        expect(await readFile(join(fixture.directory, '.env'), 'utf8')).not.toContain('OR3_AUTH_REGISTRATION_MODE');
    });

    it('rejects a stale revision and never writes an assumed local env when control is unsupported', async () => {
        fixture.readBody.mockResolvedValue({ mode: 'disabled', expectedRevision: 'stale' });
        await expect(saveSettings({} as never)).rejects.toMatchObject({ code: 'stale_revision' });
        fixture.supported = false;
        fixture.readBody.mockResolvedValue(await body('disabled'));
        await expect(saveSettings({} as never)).rejects.toMatchObject({ statusCode: 501 });
        expect(await readFile(join(fixture.directory, '.env'), 'utf8')).not.toContain('OR3_AUTH_REGISTRATION_MODE');
    });

    it('refuses infrastructure settings on the generic write route instead of writing an app-local env', async () => {
        fixture.readBody.mockResolvedValue({ entries: [{ key: 'OR3_SYNC_PROVIDER', value: 'sqlite' }], expectedRevision: (await fixture.control.status()).savedRevision });
        await expect(saveConfiguration({} as never)).rejects.toMatchObject({ statusCode: 501 });
        expect(await readFile(join(fixture.directory, '.env'), 'utf8')).not.toContain('OR3_SYNC_PROVIDER');
    });
});
