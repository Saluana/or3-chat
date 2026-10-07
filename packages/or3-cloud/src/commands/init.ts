import { chmod, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { boolFlag, type Flags, requireStringFlag, stringFlag } from '../cli/args';
import { readPassword, resolveAdminEmail } from '../credentials/inputs';
import { copyAssets } from '../deployment/assets';
import type { Mode } from '../deployment/contracts';
import {
  buildEnv,
  DEFAULT_PORT,
  secretValues,
  serializeEnv,
  serializeInitialCredentials,
  withoutProvisioningCredentials,
} from '../deployment/env';
import { composeProjectNames, imageAtDigest, imageFor } from '../deployment/identity';
import { deploymentPaths, readDirectoryEmpty } from '../deployment/paths';
import { clearPending, markPending, stateFromEnv, writeState } from '../deployment/state-store';
import { expectedImageDigest, PACKAGE_VERSION } from '../package-info';
import { run } from '../runtime/command-runner';
import { compose } from '../runtime/compose';
import { prepareVerifiedDashboardOperator } from '../runtime/dashboard-operator';
import {
  assertDockerProjectAbsent,
  checkPublicPrerequisites,
  dockerDaemonIsLocal,
  ensureDocker,
  portAvailable,
} from '../runtime/docker';
import { assertImageReleaseIdentity, assertSupportedHostArchitecture, pullImage } from '../runtime/images';
import { startProject, stopProject } from '../runtime/project';
import { provisionManagedCredentials } from '../runtime/verification';
import { fileExists, writeSecure } from '../util/fs';
import { id, now, quote, redact } from '../util/primitives';

export async function initCommand(positionals: string[], flags: Flags) {
  const hasLocal = boolFlag(flags, 'local');
  const hasPublic = boolFlag(flags, 'public');
  if (hasLocal === hasPublic) throw new Error('Choose exactly one of --local or --public.');
  const mode: Mode = hasPublic ? 'public' : 'local';
  const directory = resolve(process.cwd(), positionals[0] ?? 'or3-cloud');
  if (await fileExists(join(directory, '.or3-cloud', 'state.json'))) {
    throw new Error(`${directory} is already a managed deployment. Use update, doctor, or adopt.`);
  }
  await readDirectoryEmpty(directory);
  const domain = mode === 'public' ? requireStringFlag(flags, 'domain') : undefined;
  if (domain) {
    const address = await checkPublicPrerequisites(domain);
    console.log(`DNS: ${domain} → ${address}`);
  }
  const port = Number(stringFlag(flags, 'port') ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be a valid TCP port.');
  if (mode === 'public' && [80, 443].includes(port)) throw new Error('Public mode reserves ports 80 and 443 for Caddy; choose another --port for OR3.');
  const localDockerDaemon = await dockerDaemonIsLocal();
  if (localDockerDaemon && !await portAvailable(port)) throw new Error(`Port ${port} is already in use. Choose another port with --port.`);
  if (mode === 'public' && localDockerDaemon) {
    for (const publicPort of [80, 443]) {
      if (!await portAvailable(publicPort)) throw new Error(`Public port ${publicPort} is already in use. Stop the conflicting service before starting Caddy.`);
    }
  }
  await ensureDocker();
  const names = composeProjectNames(directory);
  await assertDockerProjectAbsent(names.project);
  for (const volume of [names.volume, ...(mode === 'public' ? [names.caddyData, names.caddyConfig] : [])]) {
    const existing = await run('docker', ['volume', 'inspect', volume]);
    if (existing.ok) throw new Error(`Docker volume ${volume} already exists. Choose a new directory or inspect it before initializing.`);
    if (existing.exitCode !== 1 || !/no such volume/i.test(`${existing.stdout}\n${existing.stderr}`)) {
      throw new Error(`Could not confirm whether Docker volume ${volume} exists. Refusing initialization until Docker returns an explicit not-found result. ${existing.stderr.trim()}`);
    }
  }
  const email = await resolveAdminEmail(flags);
  const password = await readPassword(flags);
  const version = PACKAGE_VERSION;
  const imageTag = imageFor(version);
  const digest = await pullImage(imageTag, expectedImageDigest(version));
  await assertSupportedHostArchitecture(imageTag);
  await assertImageReleaseIdentity(imageTag, version);
  const image = imageAtDigest(imageTag, digest);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await mkdir(deploymentPaths(directory).operations, { recursive: true, mode: 0o700 });
  await mkdir(deploymentPaths(directory).backups, { recursive: true, mode: 0o700 });
  const operator = await prepareVerifiedDashboardOperator(directory, version);
  await copyAssets(directory, mode);
  const env = buildEnv({ mode, version, directory, image, email, password, domain, port, dashboardOperator: operator });
  await writeSecure(deploymentPaths(directory).env, serializeEnv(env));
  await writeSecure(join(directory, '.or3-initial-credentials'), serializeInitialCredentials({
    bootstrapEmail: email,
    bootstrapPassword: password,
    adminUsername: email,
    adminPassword: password,
  }));
  const state = stateFromEnv(directory, env, mode, 'init', digest);
  await markPending(directory, state, {
    id: id('init'),
    operation: 'init',
    startedAt: now(),
    message: 'Initializing the managed deployment',
  });
  try {
    await startProject(directory, mode, env);
    await provisionManagedCredentials(
      mode === 'public' ? new URL(`https://${domain}`) : new URL(`http://127.0.0.1:${port}`),
      email,
      password,
    );
    const runtimeEnv = withoutProvisioningCredentials(env);
    await writeSecure(deploymentPaths(directory).env, serializeEnv(runtimeEnv));
    await stopProject(directory, mode);
    await startProject(directory, mode, runtimeEnv);
    await clearPending(directory, state);
    console.log(`\nOR3 Cloud ${version} is running at ${mode === 'public' ? `https://${domain}` : `http://127.0.0.1:${port}`}`);
    console.log(`Credentials were written to ${join(directory, '.or3-initial-credentials')} (mode 0600). Move them to protected storage (a password manager), then remove that file.`);
    console.log('The bootstrap owner signs in to the app; the admin account manages the deployment. Rotate either later with "npx @or3/cloud credentials reset --yes".');
    console.log(`\nCheck: cd ${quote(directory)} && npx @or3/cloud doctor`);
    if (operator) console.log('Dashboard updates are enabled for super admins in Operations.');
  } catch (error) {
    state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(env));
    await writeState(directory, state);
    await compose(directory, mode, ['down']).catch(() => undefined);
    throw new Error(`${state.lastError}\nThe new deployment files were preserved at ${directory}.`);
  }
}
