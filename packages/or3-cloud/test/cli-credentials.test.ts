import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCredentialsResetScript } from '../src/credentials/reset-script';
import { parseEnv } from '../src/deployment/env';
import { createSandbox } from './process-harness';
import type { Sandbox } from './process-harness';

// Each test drives several real CLI processes.
setDefaultTimeout(30_000);

const sandboxes: Sandbox[] = [];
async function sandbox(options?: Parameters<typeof createSandbox>[0]) {
  const created = await createSandbox(options);
  sandboxes.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((entry) => entry.cleanup()));
});

const OWNER_PASSWORD = 'New-Owner-Password-9876!';
const ADMIN_PASSWORD = 'New-Admin-Password-5432!';
const DESTRUCTIVE = /compose .* (stop|down|restart)\b|compose .* up\b|compose .* exec|volume rm|tar xzf/;

async function passwordFiles(fixture: Sandbox) {
  const owner = join(fixture.root, 'owner.pw');
  const admin = join(fixture.root, 'admin.pw');
  await writeFile(owner, `${OWNER_PASSWORD}\n`, { mode: 0o600 });
  await writeFile(admin, `${ADMIN_PASSWORD}\n`, { mode: 0o600 });
  return ['--owner-password-file', owner, '--admin-password-file', admin];
}

async function artifactText(fixture: Sandbox) {
  const files = [join(fixture.directory, '.env'), join(fixture.cloud, 'state.json'), join(fixture.directory, '.or3-initial-credentials')];
  return (await Promise.all(files.map((file) => readFile(file, 'utf8').catch(() => '')))).join('\n');
}

test('credentials reset rotates both credentials, restarts, verifies, and leaves no recovery secrets', async () => {
  const fixture = await sandbox();
  const initial = join(fixture.directory, '.or3-initial-credentials');
  await writeFile(initial, 'OR3_ADMIN_PASSWORD=old\n', { mode: 0o600 });
  const before = parseEnv(await fixture.readEnvText());
  const result = await fixture.cli(['credentials', 'reset', '--yes', ...await passwordFiles(fixture)]);
  expect(result.exitCode, result.output).toBe(0);
  expect(result.stdout).toContain('Owner and admin credentials are now separate');
  expect(result.output).not.toContain(OWNER_PASSWORD);
  expect(result.output).not.toContain(ADMIN_PASSWORD);

  const after = parseEnv(await fixture.readEnvText());
  expect(after.OR3_ADMIN_JWT_SECRET).not.toBe(before.OR3_ADMIN_JWT_SECRET);
  expect(after.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD).toBeUndefined();
  expect(after.OR3_ADMIN_PASSWORD).toBeUndefined();
  expect(after.OR3_MANAGED_OWNER_EMAIL).toBe(before.OR3_MANAGED_OWNER_EMAIL);
  expect(existsSync(initial)).toBe(false);
  const state = await fixture.readState();
  expect(state.incompleteOperation).toBeUndefined();
  expect(await artifactText(fixture)).not.toContain(OWNER_PASSWORD);
  expect(await artifactText(fixture)).not.toContain(ADMIN_PASSWORD);
  expect(existsSync(join(fixture.cloud, 'operation-lease'))).toBe(false);

  const calls = await fixture.trace();
  const text = calls.map((args) => args.join(' ')).join('\n');
  expect(text).not.toContain(OWNER_PASSWORD);
  expect(text).not.toContain(ADMIN_PASSWORD);
  const resets = calls.filter((args) => args.includes('exec') && args.includes('OR3_RESET_OWNER_PASSWORD'));
  expect(resets).toHaveLength(2);
  expect(resets.every((args) => args.join(' ').includes('-e OR3_RESET_OWNER_PASSWORD -e OR3_RESET_ADMIN_USERNAME -e OR3_RESET_ADMIN_PASSWORD'))).toBe(true);
  // Reset, then a clean restart, then credential verification against the restarted app.
  const sequence = calls.map((args) => args.join(' '));
  const reset = sequence.findIndex((call) => call.includes('basic_auth_accounts'));
  const stopped = sequence.findIndex((call, index) => index > reset && / stop or3$/.test(call));
  const started = sequence.findIndex((call, index) => index > stopped && / up -d/.test(call));
  const verified = sequence.findIndex((call, index) => index > started && call.includes('Credential verification failed'));
  expect(reset).toBeGreaterThan(-1);
  expect(stopped).toBeGreaterThan(reset);
  expect(started).toBeGreaterThan(stopped);
  expect(verified).toBeGreaterThan(started);
});

const REFUSALS: Array<[string, string[], string]> = [
  ['no confirmation', ['credentials', 'reset'], 'Re-run with --yes'],
  ['no subcommand', ['credentials'], 'Unknown credentials subcommand'],
  ['wrong subcommand', ['credentials', 'rotate', '--yes'], 'Unknown credentials subcommand "rotate"'],
  ['extra argument', ['credentials', 'reset', 'now', '--yes'], 'credentials reset accepts no arguments'],
  ['non-interactive without files', ['credentials', 'reset', '--yes'], 'are required in a non-interactive session'],
];
for (const [name, args, message] of REFUSALS) {
  test(`credentials reset refuses before any Docker request: ${name}`, async () => {
    const fixture = await sandbox();
    const state = await fixture.readStateText();
    const env = await fixture.readEnvText();
    const result = await fixture.cli(args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
    expect(await fixture.readStateText()).toBe(state);
    expect(await fixture.readEnvText()).toBe(env);
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
  });
}

test('credentials reset requires both credentials, valid passwords, and one source for each', async () => {
  const fixture = await sandbox();
  const owner = join(fixture.root, 'owner.pw');
  await writeFile(owner, `${OWNER_PASSWORD}\n`);
  const weak = join(fixture.root, 'weak.pw');
  await writeFile(weak, 'short\n');
  const state = await fixture.readStateText();
  const cases: Array<[string[], string]> = [
    [['--owner-password-file', owner], 'Supply both owner and admin passwords'],
    [['--admin-password', ADMIN_PASSWORD], 'Supply both owner and admin passwords'],
    [['--owner-password-file', owner, '--admin-password-file', weak], 'password'],
    [['--owner-password', OWNER_PASSWORD, '--owner-password-file', owner, '--admin-password', ADMIN_PASSWORD], 'Use either --owner-password or --owner-password-file, not both.'],
    [['--owner-password-file', join(fixture.root, 'missing.pw'), '--admin-password', ADMIN_PASSWORD], 'ENOENT'],
    [['--owner-password', '--admin-password', ADMIN_PASSWORD], '--owner-password requires a value.'],
  ];
  for (const [flags, message] of cases) {
    const result = await fixture.cli(['credentials', 'reset', '--yes', ...flags]);
    expect(result.exitCode, flags.join(' ')).toBe(1);
    expect(result.stderr, flags.join(' ')).toContain(message);
    expect(result.output).not.toContain(OWNER_PASSWORD);
    expect(result.output).not.toContain(ADMIN_PASSWORD);
  }
  expect(await fixture.readStateText()).toBe(state);
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

test('credentials reset refuses missing owner or admin identity and a pending operation', async () => {
  const noAdmin = await sandbox();
  const env = (await noAdmin.readEnvText()).replace(/^OR3_ADMIN_USERNAME=.*\n/m, '');
  await writeFile(join(noAdmin.directory, '.env'), env);
  const missing = await noAdmin.cli(['credentials', 'reset', '--yes', ...await passwordFiles(noAdmin)]);
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toContain('OR3_ADMIN_USERNAME is missing from .env');

  const noOwner = await sandbox();
  await writeFile(join(noOwner.directory, '.env'), (await noOwner.readEnvText()).replace(/^OR3_MANAGED_OWNER_EMAIL=.*\n/m, ''));
  const ownerless = await noOwner.cli(['credentials', 'reset', '--yes', ...await passwordFiles(noOwner)]);
  expect(ownerless.exitCode).toBe(1);
  expect(ownerless.stderr).toContain('The managed owner email is missing from .env');

  const pending = await sandbox();
  const state = await pending.readState();
  state.incompleteOperation = { id: 'update-1', operation: 'update', startedAt: state.updatedAt, message: 'x', phase: 'target-mutating' };
  await pending.writeState(state);
  const blocked = await pending.cli(['credentials', 'reset', '--yes', ...await passwordFiles(pending)]);
  expect(blocked.exitCode).toBe(1);
  expect(blocked.stderr).toContain('An incomplete update is recorded');
  for (const fixture of [noAdmin, noOwner, pending]) expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

test('a failed reset script leaves the old credentials live and a protected, replayable journal', async () => {
  const fixture = await sandbox();
  const initial = join(fixture.directory, '.or3-initial-credentials');
  await writeFile(initial, 'OR3_ADMIN_PASSWORD=old\n', { mode: 0o600 });
  const envBefore = await fixture.readEnvText();
  await fixture.configure({ failures: [{ match: 'basic_auth_accounts', message: 'OR3 credentials reset failed: fixture failure' }] });
  const failed = await fixture.cli(['credentials', 'reset', '--yes', ...await passwordFiles(fixture)]);
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain('OR3 credentials reset failed: fixture failure');
  expect(failed.stderr).toContain('Credential reset is recoverable');
  expect(failed.output).not.toContain(OWNER_PASSWORD);
  expect(failed.output).not.toContain(ADMIN_PASSWORD);
  expect(await fixture.readEnvText()).toBe(envBefore);
  expect(existsSync(initial)).toBe(true);

  const state = await fixture.readState();
  const pending = state.incompleteOperation!;
  expect(pending).toMatchObject({ operation: 'credentials-reset' });
  expect(pending.credentialReset!.nextEnv.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD).toBe(OWNER_PASSWORD);
  expect(pending.credentialReset!.nextEnv.OR3_ADMIN_PASSWORD).toBe(ADMIN_PASSWORD);
  expect(((await stat(join(fixture.cloud, 'state.json'))).mode & 0o777)).toBe(0o600);
  expect(((await stat(join(fixture.cloud, 'operations', `${pending.id}.json`))).mode & 0o777)).toBe(0o600);
  expect(state.lastError).not.toContain(OWNER_PASSWORD);

  // The recovery secret never reaches any observation command.
  for (const args of [['status', '--json'], ['status'], ['recover', '--dry-run', '--json'], ['doctor']]) {
    const observed = await fixture.cli(args);
    expect(observed.output, args.join(' ')).not.toContain(OWNER_PASSWORD);
    expect(observed.output, args.join(' ')).not.toContain(ADMIN_PASSWORD);
  }
  const blocked = await fixture.cli(['start']);
  expect(blocked.stderr).toContain('An incomplete credentials-reset is recorded');

  await fixture.configure({ failures: [] });
  const recovered = await fixture.cli(['recover']);
  expect(recovered.exitCode, recovered.output).toBe(0);
  expect(recovered.stdout).toContain('Recovered the incomplete credential reset');
  expect(recovered.output).not.toContain(OWNER_PASSWORD);
  const after = parseEnv(await fixture.readEnvText());
  expect(after.OR3_ADMIN_PASSWORD).toBeUndefined();
  expect(after.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD).toBeUndefined();
  expect(after.OR3_ADMIN_JWT_SECRET).toBe(pending.credentialReset!.nextEnv.OR3_ADMIN_JWT_SECRET);
  expect(existsSync(initial)).toBe(false);
  const final = await fixture.readState();
  expect(final.incompleteOperation).toBeUndefined();
  expect(final.lastError).toBeUndefined();
  expect(existsSync(join(fixture.cloud, 'operations', `${pending.id}.json`))).toBe(false);
  expect(await artifactText(fixture)).not.toContain(OWNER_PASSWORD);
});

test('a reset interrupted after the credentials changed replays safely', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: 'Credential verification failed', times: 1, message: 'Credential verification failed: fixture' }] });
  const failed = await fixture.cli(['credentials', 'reset', '--yes', ...await passwordFiles(fixture)]);
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain('Credential reset is recoverable');
  expect((await fixture.readState()).incompleteOperation).toMatchObject({ operation: 'credentials-reset' });
  // The runtime configuration had already rotated; the journal still holds the intended values.
  expect(parseEnv(await fixture.readEnvText()).OR3_ADMIN_PASSWORD).toBeUndefined();

  const recovered = await fixture.cli(['recover']);
  expect(recovered.exitCode, recovered.output).toBe(0);
  expect((await fixture.readState()).incompleteOperation).toBeUndefined();
  const resets = (await fixture.trace()).filter((args) => args.join(' ').includes('basic_auth_accounts'));
  expect(resets).toHaveLength(2);
});

test('a credential journal without protected recovery data is never guessed', async () => {
  const fixture = await sandbox();
  const state = await fixture.readState();
  state.incompleteOperation = { id: 'credentials-reset-fixture', operation: 'credentials-reset', startedAt: state.updatedAt, message: 'fixture' };
  await fixture.writeState(state);
  const result = await fixture.cli(['recover']);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('has no protected recovery data');
  expect((await fixture.readState()).incompleteOperation).toMatchObject({ operation: 'credentials-reset' });
  expect(await fixture.traceText()).not.toMatch(/compose .* (stop|down|restart)|compose .* up|compose .* exec/);
});

// The reset script runs inside the application image. Execute it for real
// against SQLite and bcrypt so the security-relevant semantics are pinned.
const repoRoot = join(import.meta.dir, '../../..');
const nodeBinary = Bun.which('node');
const nodeHasSqlite = Boolean(nodeBinary)
  && Bun.spawnSync([nodeBinary!, '-e', "require('better-sqlite3');require('bcryptjs')"], { cwd: repoRoot }).exitCode === 0;
const scriptTest = test.skipIf(!nodeHasSqlite);

async function node(args: string[], options: { cwd: string; env?: Record<string, string> }) {
  const child = Bun.spawn([nodeBinary!, ...args], { cwd: options.cwd, env: { PATH: process.env.PATH ?? '', ...options.env }, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { exitCode, stdout, stderr };
}

type Account = { password_hash: string; token_version: number };
type Session = { id: string; revoked_at: number | null; rotation_grace_until: number | null; rotation_grace_refresh_token: string | null };
type ScriptState = { account: Account | undefined; other: Account | undefined; sessions: Session[] };
type ScriptWorkspace = {
  work: string;
  db: string;
  admin: string;
  seed(options?: { sessions?: boolean; owner?: boolean }): Promise<void>;
  read(): Promise<ScriptState>;
  run(overrides?: Record<string, string | undefined>, options?: { image?: 'both' | 'sqlite-only' | 'none' }): ReturnType<typeof node>;
};

async function scriptWorkspace(): Promise<ScriptWorkspace> {
  const work = await realpath(await mkdtemp(join(tmpdir(), 'or3-reset-script-')));
  workspaces.push(work);
  const modules = join(work, '.output', 'server', 'node_modules');
  const db = join(work, 'auth.sqlite');
  const admin = join(work, 'admin', 'admin-credentials.json');
  const link = async (image: 'both' | 'sqlite-only' | 'none') => {
    await rm(modules, { recursive: true, force: true });
    if (image === 'none') return;
    await mkdir(join(modules, 'bcryptjs'), { recursive: true });
    await symlink(join(repoRoot, 'node_modules', 'better-sqlite3'), join(modules, 'better-sqlite3'));
    if (image === 'both') await writeFile(join(modules, 'bcryptjs', 'index.js'), `module.exports = require(${JSON.stringify(join(repoRoot, 'node_modules', 'bcryptjs'))});\n`);
    else await rm(join(modules, 'bcryptjs'), { recursive: true, force: true });
  };
  const sqlite = join(repoRoot, 'node_modules', 'better-sqlite3');
  return {
    work,
    db,
    admin,
    async seed(options = {}) {
      await mkdir(join(work, 'admin'), { recursive: true });
      const source = `
        const Database = require(${JSON.stringify(sqlite)});
        const bcrypt = require(${JSON.stringify(join(repoRoot, 'node_modules', 'bcryptjs'))});
        const db = new Database(${JSON.stringify(db)});
        db.exec("CREATE TABLE basic_auth_accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, token_version INTEGER NOT NULL DEFAULT 0, updated_at INTEGER)");
        ${options.sessions === false ? '' : `db.exec("CREATE TABLE basic_auth_sessions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, revoked_at INTEGER, rotation_grace_until INTEGER, rotation_grace_refresh_token TEXT)");`}
        ${options.owner === false ? '' : `
        db.prepare("INSERT INTO basic_auth_accounts (id, email, password_hash, token_version, updated_at) VALUES ('acct-1', 'owner@example.test', ?, 4, 1)").run(bcrypt.hashSync('Old-Owner-Password-1!', 4));
        db.prepare("INSERT INTO basic_auth_accounts (id, email, password_hash, token_version, updated_at) VALUES ('acct-2', 'other@example.test', ?, 7, 1)").run(bcrypt.hashSync('Other-Password-1!', 4));
        ${options.sessions === false ? '' : `
        db.exec("INSERT INTO basic_auth_sessions VALUES ('s1', 'acct-1', NULL, 99, 'grace-token'), ('s2', 'acct-1', 555, NULL, NULL), ('s3', 'acct-2', NULL, NULL, NULL)");`}`}
        db.close();`;
      const seeded = await node(['-e', source], { cwd: work });
      expect(seeded.exitCode, seeded.stderr).toBe(0);
      await writeFile(admin, `${JSON.stringify({ username: 'old-admin', password_hash_bcrypt: 'old-hash', created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z' }, null, 2)}\n`);
    },
    async read() {
      const source = `
        const Database = require(${JSON.stringify(sqlite)});
        const db = new Database(${JSON.stringify(db)}, { readonly: true });
        const sessions = (() => { try { return db.prepare("SELECT id, revoked_at, rotation_grace_until, rotation_grace_refresh_token FROM basic_auth_sessions ORDER BY id").all(); } catch { return []; } })();
        console.log(JSON.stringify({ account: db.prepare("SELECT password_hash, token_version FROM basic_auth_accounts WHERE id = 'acct-1'").get(), other: db.prepare("SELECT password_hash, token_version FROM basic_auth_accounts WHERE id = 'acct-2'").get(), sessions }));`;
      const read = await node(['-e', source], { cwd: work });
      return JSON.parse(read.stdout);
    },
    run(overrides = {}, options = {}) {
      const image = options.image ?? 'both';
      const prepared = link(image);
      const script = buildCredentialsResetScript({ ownerEmail: 'owner@example.test', ownerPassword: 'x', adminUsername: 'x', adminPassword: 'x', authDbPath: db, adminCredentialsPath: admin });
      return prepared.then(() => node(['-e', script], {
        cwd: work,
        env: {
          OR3_RESET_OWNER_EMAIL: 'owner@example.test',
          OR3_RESET_OWNER_PASSWORD: OWNER_PASSWORD,
          OR3_RESET_ADMIN_USERNAME: 'new-admin',
          OR3_RESET_ADMIN_PASSWORD: ADMIN_PASSWORD,
          ...Object.fromEntries(Object.entries(overrides).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        },
      }));
    },
  };
}
const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function bcryptMatches(password: string, hash: string) {
  const check = await node(['-e', `console.log(require(${JSON.stringify(join(repoRoot, 'node_modules', 'bcryptjs'))}).compareSync(${JSON.stringify(password)}, ${JSON.stringify(hash)}))`], { cwd: repoRoot });
  return check.stdout.trim() === 'true';
}

scriptTest('the reset script rotates the owner hash, bumps token_version, revokes sessions, and rewrites the admin file', async () => {
  const space = await scriptWorkspace();
  await space.seed();
  const result = await space.run();
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain('credentials-reset: owner hash, sessions, and admin credentials updated.');
  expect(result.stdout + result.stderr).not.toContain(OWNER_PASSWORD);
  expect(result.stdout + result.stderr).not.toContain(ADMIN_PASSWORD);
  const after = await space.read();
  expect(await bcryptMatches(OWNER_PASSWORD, after.account!.password_hash)).toBe(true);
  expect(await bcryptMatches('Old-Owner-Password-1!', after.account!.password_hash)).toBe(false);
  expect(after.account!.token_version).toBe(5);
  const sessions = Object.fromEntries(after.sessions.map((session) => [session.id, session]));
  expect(sessions.s1.revoked_at).toBeGreaterThan(1000);
  expect(sessions.s1.rotation_grace_until).toBeNull();
  expect(sessions.s1.rotation_grace_refresh_token).toBeNull();
  expect(sessions.s2.revoked_at).toBe(555);
  expect(sessions.s3.revoked_at).toBeNull();
  expect(after.other!.token_version).toBe(7);
  const credentials = JSON.parse(await readFile(space.admin, 'utf8'));
  expect(credentials).toMatchObject({ username: 'new-admin', created_at: '2020-01-01T00:00:00.000Z' });
  expect(await bcryptMatches(ADMIN_PASSWORD, credentials.password_hash_bcrypt)).toBe(true);
  expect(Date.parse(credentials.updated_at)).toBeGreaterThan(Date.parse('2020-01-02'));
  expect(((await stat(space.admin)).mode & 0o777)).toBe(0o600);

  const replay = await space.run();
  expect(replay.exitCode, replay.stderr).toBe(0);
  expect((await space.read()).account!.token_version).toBe(6);
});

scriptTest('the reset script creates the admin credentials file when none exists', async () => {
  const space = await scriptWorkspace();
  await space.seed();
  await rm(space.admin);
  const result = await space.run();
  expect(result.exitCode, result.stderr).toBe(0);
  const credentials = JSON.parse(await readFile(space.admin, 'utf8'));
  expect(credentials.username).toBe('new-admin');
  expect(typeof credentials.created_at).toBe('string');
});

scriptTest('the reset script changes nothing when the owner account does not exist', async () => {
  const space = await scriptWorkspace();
  await space.seed();
  const adminBefore = await readFile(space.admin, 'utf8');
  const dbBefore = await space.read();
  const result = await space.run({ OR3_RESET_OWNER_EMAIL: 'nobody@example.test' });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('no Basic Auth account matches OR3_BASIC_AUTH_BOOTSTRAP_EMAIL. Nothing was changed.');
  expect(await readFile(space.admin, 'utf8')).toBe(adminBefore);
  expect(await space.read()).toEqual(dbBefore);
});

scriptTest('the reset script fails closed when the image lacks better-sqlite3 or bcryptjs', async () => {
  const space = await scriptWorkspace();
  await space.seed();
  const adminBefore = await readFile(space.admin, 'utf8');
  const dbBefore = await space.read();
  const noSqlite = await space.run({}, { image: 'none' });
  expect(noSqlite.exitCode).toBe(1);
  expect(noSqlite.stderr).toContain('better-sqlite3 is not available in this image');
  expect(noSqlite.stderr).toContain('Nothing was changed.');
  const noBcrypt = await space.run({}, { image: 'sqlite-only' });
  expect(noBcrypt.exitCode).toBe(1);
  expect(noBcrypt.stderr).toContain('bcryptjs is not available in this image');
  expect(noBcrypt.stderr).toContain('Nothing was changed.');
  expect(await readFile(space.admin, 'utf8')).toBe(adminBefore);
  expect(await space.read()).toEqual(dbBefore);
});

scriptTest('the reset script refuses missing inputs and a corrupt admin file without partial writes', async () => {
  const space = await scriptWorkspace();
  await space.seed();
  const dbBefore = await space.read();
  for (const missing of ['OR3_RESET_OWNER_EMAIL', 'OR3_RESET_OWNER_PASSWORD', 'OR3_RESET_ADMIN_USERNAME', 'OR3_RESET_ADMIN_PASSWORD']) {
    const result = await space.run({ [missing]: '' });
    expect(result.exitCode, missing).toBe(1);
    expect(result.stderr).toContain('required environment values were not supplied');
  }
  await writeFile(space.admin, '{not json');
  const corrupt = await space.run();
  expect(corrupt.exitCode).toBe(1);
  expect(corrupt.stderr).toContain('the admin credentials file is corrupt. Nothing was changed.');
  expect(await readFile(space.admin, 'utf8')).toBe('{not json');
  expect(await space.read()).toEqual(dbBefore);
});

scriptTest('a failed database update rolls back and restores the previous admin credentials', async () => {
  const space = await scriptWorkspace();
  await space.seed({ sessions: false });
  const adminBefore = await readFile(space.admin, 'utf8');
  const dbBefore = await space.read();
  const result = await space.run();
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('the atomic database/file update did not complete. Replay is safe through the managed recovery journal.');
  expect(result.stdout + result.stderr).not.toContain(OWNER_PASSWORD);
  expect(await readFile(space.admin, 'utf8')).toBe(adminBefore);
  const after = await space.read();
  expect(after.account).toEqual(dbBefore.account);
  expect(after.account!.token_version).toBe(4);

  const fresh = await scriptWorkspace();
  await fresh.seed({ sessions: false });
  await rm(fresh.admin);
  const noPrevious = await fresh.run();
  expect(noPrevious.exitCode).toBe(1);
  expect(existsSync(fresh.admin)).toBe(false);
});
