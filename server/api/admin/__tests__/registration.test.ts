import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = vi.hoisted(() => ({ directory: '', readBody: vi.fn(), authorize: vi.fn(), config: {
    auth: { registrationMode: 'open', invite: { tokenSecret: 'server-only-secret' } },
} }));
vi.mock('h3', async (importOriginal) => ({
    ...await importOriginal<typeof import('h3')>(),
    defineEventHandler: (handler: unknown) => handler,
    readBody: fixture.readBody,
    setResponseHeader: vi.fn(),
}));
vi.mock('#imports', () => ({ useRuntimeConfig: () => fixture.config }));
vi.mock('../../../admin/api', () => ({ requireAdminApiContext: fixture.authorize }));
vi.mock('../../../admin/auth/rate-limit', () => ({ enforceGenericAdminRateLimit: vi.fn() }));
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
    });
    afterEach(async () => { await rm(fixture.directory, { recursive: true, force: true }); });

    it.each(['open', 'invite_only', 'disabled'])('persists %s without changing the active policy or unrelated values', async mode => {
        fixture.readBody.mockResolvedValue({ mode });
        await expect(saveSettings({} as never)).resolves.toMatchObject({ savedMode: mode, restartRequired: mode !== 'open' });
        const saved = await readSettings({} as never);
        expect(saved).toEqual({ currentMode: 'open', savedMode: mode, restartRequired: mode !== 'open', inviteSigningConfigured: true });
        expect(await readFile(join(fixture.directory, '.env'), 'utf8')).toContain('# Preserve this setting\nOR3_SITE_NAME=MyChat\n');
        expect(fixture.config.auth.registrationMode).toBe('open');
        expect(JSON.stringify(saved)).not.toContain('server-only-secret');
        expect(fixture.authorize).toHaveBeenCalledWith({}, { superAdminOnly: true, mutation: true });
    });

    it.each([{}, { mode: 'public' }, { mode: '' }, { mode: null }, { mode: 'open', extra: true }])('rejects invalid settings %j without writing', async body => {
        fixture.readBody.mockResolvedValue(body);
        await expect(saveSettings({} as never)).rejects.toMatchObject({ statusCode: 400 });
        expect(await readFile(join(fixture.directory, '.env'), 'utf8')).not.toContain('OR3_AUTH_REGISTRATION_MODE');
    });

    it('requires invitation setup before saving invite-only registration', async () => {
        fixture.config.auth.invite.tokenSecret = '';
        fixture.readBody.mockResolvedValue({ mode: 'invite_only' });
        await expect(saveSettings({} as never)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Set up invitations before choosing Invite only.' });
        expect(await readSettings({} as never)).toMatchObject({ inviteSigningConfigured: false, savedMode: 'open' });
        expect(await readFile(join(fixture.directory, '.env'), 'utf8')).not.toContain('OR3_AUTH_REGISTRATION_MODE');
    });

    it('clears the restart notice after the saved mode becomes active', async () => {
        fixture.readBody.mockResolvedValue({ mode: 'invite_only' });
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
});
