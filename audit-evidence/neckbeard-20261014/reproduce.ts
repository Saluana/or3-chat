/**
 * Read-only audit of production behavior using disposable fixtures.
 * Run: bunx vite-node --config vitest.config.ts audit-evidence/neckbeard-20261014/reproduce.ts
 * No live server, credentials, database, or deployment is accessed.
 * Failure cases: remote device-only KV overwrite; invalid pull acknowledgement;
 * concurrent cursor overwrite; duplicate per-tab HLC; unreserved login attempts;
 * stale admin token after credential rotation; ignored API host allowlist;
 * bcrypt suffix truncation; world-readable explicitly persisted wizard secrets;
 * credentials left in an inactive workspace after logout cleanup.
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { useState } from '../../tests/stubs/nuxt-imports';
import type { SessionPayload } from '../../app/composables/auth/useSessionContext';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, toWebHandler, type H3Event } from 'h3';
import { Or3DB, setActiveWorkspaceDb } from '../../app/db/client';
import { persistUserApiKey, clearPersistedUserApiKey, hydrateUserApiKeyFromKv, useUserApiKey } from '../../app/core/auth/useUserApiKey';
import { ConflictResolver } from '../../app/core/sync/conflict-resolver';
import { CursorManager } from '../../app/core/sync/cursor-manager';
import { HLCGenerator } from '../../app/core/sync/hlc';
import { createHookEngine } from '../../app/core/hooks/hooks';
import { createTypedHookEngine } from '../../app/core/hooks/typed-hooks';
import { setHookEngine } from '../../app/core/hooks/useHooks';
import { getLocalOnlyKvNames } from '../../app/core/sync/hook-bridge';
import { checkRateLimit, clearRateLimit } from '../../server/admin/auth/rate-limit';
import { signAdminJwt, verifyAdminJwt } from '../../server/admin/auth/jwt';
import { writeAdminCredentials, updateAdminCredentials } from '../../server/admin/auth/credentials';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../server/admin/auth/hash';
import adminGate from '../../server/middleware/admin-gate';
import login from '../../server/api/admin/auth/login.post';
import { saveSession } from '../../shared/cloud/wizard/store';

const root = await mkdtemp(join(tmpdir(), 'or3-neckbeard-'));
const db = new Or3DB(`or3-audit-${crypto.randomUUID()}`);
const oldAdminDir = process.env.OR3_ADMIN_DATA_DIR;
const oldWizardHome = process.env.OR3_CLOUD_WIZARD_HOME;
const oldUmask = process.umask(0o022);
const config = {
    public: { ssrAuthEnabled: false },
    admin: { basePath: '/admin', allowedHosts: ['admin.example.test'], auth: {
        jwtSecret: 'audit-fixture-secret-with-at-least-32-bytes', jwtExpiry: '24h',
    } },
    security: { forceHttps: false, proxy: { trust: false }, allowedOrigins: [] },
};
(globalThis as typeof globalThis & { useRuntimeConfig: () => typeof config }).useRuntimeConfig = () => config;
setHookEngine(createTypedHookEngine(createHookEngine()));
const report = (name: string, observed: unknown) => console.log(JSON.stringify({ name, observed }));
try {
    await db.open();
    const pk = 'kv:openrouter_api_key';
    const seed = { id: pk, name: 'openrouter_api_key', value: 'local-fixture-key', clock: 1,
        created_at: 1, updated_at: 1, deleted: false };
    await db.kv.put(seed);
    await new ConflictResolver(db).applyChanges([{
        serverVersion: 2, tableName: 'kv', pk, op: 'put',
        payload: { ...seed, value: 'remote-fixture-key', clock: 2 },
        stamp: { clock: 2, hlc: '000000002:000:remote', opId: 'remote-op', deviceId: 'remote' },
    }]);
    assert.equal((await db.kv.get(pk))?.value, 'local-fixture-key');
    report('incremental-sync-overwrites-device-only-key', {
        excludedByPolicy: getLocalOnlyKvNames().has(seed.name), stored: (await db.kv.get(pk))?.value,
    });
    await assert.rejects(new ConflictResolver(db).applyChanges([{
        serverVersion: 3, tableName: 'messages', pk: 'invalid-message', op: 'put', payload: {},
        stamp: { clock: 1, hlc: '000000003:000:remote', opId: 'bad-op', deviceId: 'remote' },
    }]), /Invalid sync payload/);
    report('invalid-remote-row-rejected', true);
    const a = new CursorManager(db, { workspaceId: 'audit' });
    const b = new CursorManager(db, { workspaceId: 'audit' });
    await a.setCursor(10);
    await Promise.all([a.setCursor(11), b.markSyncComplete()]);
    assert.equal(await a.getCursor(), 11);
    report('concurrent-sync-complete-regresses-cursor', await a.getCursor());
    const oldNow = Date.now;
    const storageGlobals = globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> | undefined };
    const oldStorage = storageGlobals.localStorage;
    try {
        storageGlobals.localStorage = { getItem: () => 'same-device', setItem() {} };
        Date.now = () => 1_800_000_000_000;
        report('two-tab-generators-produce-identical-hlc', new HLCGenerator().generate() === new HLCGenerator().generate());
    } finally { Date.now = oldNow; storageGlobals.localStorage = oldStorage; }
    clearRateLimit('audit-ip', 'audit-user');
    report('concurrent-login-admissions-before-first-failure', Array.from({ length: 20 }, () => checkRateLimit('audit-ip', 'audit-user')).filter(x => x.allowed).length);
    for (let i = 0; i < 5; i++) checkRateLimit('audit-ip', 'audit-user');
    report('username-rotation-bypasses-exhausted-ip', { blocked: !checkRateLimit('audit-ip', 'audit-user').allowed, freshUsernameAllowed: checkRateLimit('audit-ip', 'different-user').allowed });
    process.env.OR3_ADMIN_DATA_DIR = join(root, 'admin');
    const originalPassword = 'AuditOriginal123!';
    await writeAdminCredentials({ username: 'audit-admin', password_hash_bcrypt: await hashPassword(originalPassword), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const event = {} as H3Event;
    const token = await signAdminJwt(event, 'audit-admin');
    await updateAdminCredentials({ password_hash_bcrypt: await hashPassword('AuditReplacement456!') });
    assert.equal(await verifyAdminJwt(event, token), null);
    report('old-admin-jwt-valid-after-password-rotation', Boolean(await verifyAdminJwt(event, token)));
    const app = createApp().use(adminGate).use('/api/admin/auth/login', login);
    const response = await toWebHandler(app)(new Request('http://public.example.test/api/admin/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json', host: 'public.example.test' },
        body: JSON.stringify({ username: 'audit-admin', password: 'AuditReplacement456!' }),
    }));
    assert.equal(response.status, 404);
    report('login-through-disallowed-admin-host', { status: response.status, body: await response.json() as unknown });
    const prefix = 'Aa1'.repeat(24);
    await assert.rejects(hashPassword(prefix + 'original'), /72 UTF-8 bytes/);
    assert.equal(validatePasswordStrength(prefix + 'original').valid, false);
    report('bcrypt-overlength-password-rejected', true);
    process.env.OR3_CLOUD_WIZARD_HOME = join(root, 'wizard');
    const timestamp = new Date().toISOString();
    await saveSession({ id: 'audit-session', createdAt: timestamp, updatedAt: timestamp, currentStepId: 'admin', answers: { adminPassword: 'fixture-only' }, metadata: { includeSecrets: true } });
    report('wizard-secret-session-mode-with-normal-umask', ((await stat(join(root, 'wizard/.or3-cloud/sessions/audit-session.json'))).mode & 0o777).toString(8));
    const workspaceA = `audit-a-${crypto.randomUUID()}`;
    const workspaceB = `audit-b-${crypto.randomUUID()}`;
    const dbA = setActiveWorkspaceDb(workspaceA);
    await persistUserApiKey('sk-or-audit-person-a-fixture');
    const dbB = setActiveWorkspaceDb(workspaceB);
    await clearPersistedUserApiKey();
    setActiveWorkspaceDb(workspaceA);
    await hydrateUserApiKeyFromKv();
    assert.equal(useUserApiKey().apiKey.value, null);
    report('inactive-workspace-key-survives-logout-cleanup', useUserApiKey().apiKey.value === 'sk-or-audit-person-a-fixture');
    config.public.ssrAuthEnabled = true;
    const account = useState<SessionPayload | null>('auth-session', () => null);
    account.value = null;
    await persistUserApiKey('sk-or-audit-guest-fixture');
    useUserApiKey().clearKey();
    await hydrateUserApiKeyFromKv();
    assert.equal(useUserApiKey().apiKey.value, 'sk-or-audit-guest-fixture');
    report('guest-key-round-trip', true);
    account.value = { session: { authenticated: true, user: { id: 'account-a' } } } as never;
    await persistUserApiKey('sk-or-audit-owned-person-a-fixture');
    account.value = { session: { authenticated: true, user: { id: 'account-b' } } } as never;
    useUserApiKey().clearKey();
    await hydrateUserApiKeyFromKv();
    assert.equal(useUserApiKey().apiKey.value, null);
    report('account-b-cannot-hydrate-account-a-key', true);
    await clearPersistedUserApiKey();
    setActiveWorkspaceDb(null);
    await dbA.delete(); await dbB.delete();
} finally {
    await db.delete();
    setHookEngine(null);
    process.umask(oldUmask);
    if (oldAdminDir === undefined) delete process.env.OR3_ADMIN_DATA_DIR; else process.env.OR3_ADMIN_DATA_DIR = oldAdminDir;
    if (oldWizardHome === undefined) delete process.env.OR3_CLOUD_WIZARD_HOME; else process.env.OR3_CLOUD_WIZARD_HOME = oldWizardHome;
    await rm(root, { recursive: true, force: true });
}
