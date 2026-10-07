import { chmod, mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { archiveExternalVolume, restoreVolumeArchive } from '../backup/archive';
import { readManifest, writeBackupAuthentication } from '../backup/manifests';
import { type Flags, requireStringFlag } from '../cli/args';
import { validateEmail, validatePassword } from '../credentials/inputs';
import {
  assertSupportedSource,
  assertSupportedSourceCompose,
  readSourceVolume,
  restartSource,
  sourceComposeArgs,
  sourceMode,
  sourceServiceRunning,
} from '../deployment/adoption-source';
import { copyAssets } from '../deployment/assets';
import type { BackupManifest, Mode } from '../deployment/contracts';
import {
  ALLOWED_ENV_KEYS,
  buildEnv,
  DEFAULT_PORT,
  parseEnv,
  SECRET_KEYS,
  secretValues,
  serializeEnv,
  serializeInitialCredentials,
  withoutProvisioningCredentials,
} from '../deployment/env';
import {
  composeProjectNames,
  imageAtDigest,
  imageFor,
  isVersion,
  sanitizeName,
} from '../deployment/identity';
import { backupDirectory, deploymentPaths, readDirectoryEmpty } from '../deployment/paths';
import {
  clearPending,
  markPending,
  stateFromEnv,
  updatePending,
  writeState,
} from '../deployment/state-store';
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
import { copySecure, fileExists, readText, sha256File, writeSecure } from '../util/fs';
import { id, now, redact } from '../util/primitives';

export async function adoptCommand(positionals: string[], flags: Flags) {
  const sourceDirectory = resolve(requireStringFlag(flags, 'from'));
  const targetDirectory = resolve(process.cwd(), positionals[0] ?? `${basename(sourceDirectory)}-managed`);
  if (targetDirectory === sourceDirectory) throw new Error('Choose a separate target directory for adoption.');
  await readDirectoryEmpty(targetDirectory);
  if (!await fileExists(join(sourceDirectory, 'or3-release.json'))) throw new Error(`V1 release metadata is missing at ${sourceDirectory}/or3-release.json.`);
  const release = JSON.parse(await readText(join(sourceDirectory, 'or3-release.json'))) as { or3Version?: string };
  if (!release.or3Version || !isVersion(release.or3Version)) throw new Error('V1 release metadata does not contain a usable OR3 version.');
  if (release.or3Version !== PACKAGE_VERSION) {
    throw new Error(`V1 is on OR3 ${release.or3Version}, but this CLI ships managed assets for ${PACKAGE_VERSION}. Run the matching @or3/cloud version or perform a qualified host CLI update before adoption.`);
  }
  const sourceEnv = parseEnv(await readText(join(sourceDirectory, '.env')));
  const providers = await readText(join(sourceDirectory, 'or3.providers.generated.ts'));
  assertSupportedSource(sourceDirectory, sourceEnv, providers);
  const mode = sourceMode(sourceDirectory, sourceEnv) as Mode;
  const domain = mode === 'public' ? sourceEnv.OR3_PUBLIC_DOMAIN : undefined;
  if (domain) await checkPublicPrerequisites(domain);
  const sourceComposeFiles = ['-f', join(sourceDirectory, 'compose.yaml')];
  if (mode === 'public') sourceComposeFiles.push('-f', join(sourceDirectory, 'compose.public.yaml'));
  await ensureDocker();
  const sourceConfig = await run('docker', [
    'compose', '--project-directory', sourceDirectory, '--env-file', join(sourceDirectory, '.env'),
    ...sourceComposeFiles, 'config', '--format', 'json',
  ], sourceDirectory);
  if (!sourceConfig.ok) throw new Error(`The V1 Compose configuration is invalid. ${redact(sourceConfig.stderr, secretValues(sourceEnv))}`);
  const sourceImage = imageFor(release.or3Version);
  if (sourceEnv.OR3_VERSION && sourceEnv.OR3_VERSION !== release.or3Version) {
    throw new Error(`V1 OR3_VERSION ${sourceEnv.OR3_VERSION} does not match or3-release.json ${release.or3Version}.`);
  }
  const digest = await pullImage(sourceImage, expectedImageDigest(release.or3Version));
  await assertSupportedHostArchitecture(sourceImage);
  await assertImageReleaseIdentity(sourceImage, release.or3Version);
  const image = imageAtDigest(sourceImage, digest);
  if (sourceEnv.OR3_IMAGE && sourceEnv.OR3_IMAGE !== sourceImage && sourceEnv.OR3_IMAGE !== image) {
    throw new Error(`V1 OR3_IMAGE ${sourceEnv.OR3_IMAGE} does not match the authenticated image for ${release.or3Version}.`);
  }
  const sourceVolume = await readSourceVolume(sourceDirectory);
  const email = sourceEnv.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  const password = sourceEnv.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD;
  validateEmail(email);
  validatePassword(password);
  const sourcePort = Number(sourceEnv.OR3_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(sourcePort) || sourcePort < 1 || sourcePort > 65535) throw new Error('V1 project has an invalid OR3 port.');
  if (mode === 'public' && [80, 443].includes(sourcePort)) throw new Error('V1 public deployment uses a Caddy port for OR3; adoption requires a separate OR3 port.');
  assertSupportedSourceCompose(sourceConfig.stdout, sourceVolume, sourcePort);
  const sourceInitiallyRunning = await sourceServiceRunning(sourceDirectory, sourceComposeFiles);
  const targetNames = composeProjectNames(targetDirectory);
  await assertDockerProjectAbsent(targetNames.project);
  for (const volume of [targetNames.volume, ...(mode === 'public' ? [targetNames.caddyData, targetNames.caddyConfig] : [])]) {
    const existing = await run('docker', ['volume', 'inspect', volume]);
    if (existing.ok) throw new Error(`Docker volume ${volume} already exists. Choose a new adoption target directory.`);
    if (existing.exitCode !== 1 || !/no such volume/i.test(`${existing.stdout}\n${existing.stderr}`)) {
      throw new Error(`Could not confirm whether Docker volume ${volume} exists. Refusing adoption until Docker returns an explicit not-found result. ${existing.stderr.trim()}`);
    }
  }
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  await chmod(targetDirectory, 0o700);
  await mkdir(deploymentPaths(targetDirectory).operations, { recursive: true, mode: 0o700 });
  await mkdir(deploymentPaths(targetDirectory).backups, { recursive: true, mode: 0o700 });
  const operator = await prepareVerifiedDashboardOperator(targetDirectory, release.or3Version);
  await copyAssets(targetDirectory, mode);
  const copiedSecrets: Record<string, string> = {};
  for (const key of SECRET_KEYS) if (sourceEnv[key]) copiedSecrets[key] = sourceEnv[key];
  const targetEnv = buildEnv({
    mode,
    version: release.or3Version,
    directory: targetDirectory,
    image,
    email,
    password,
    domain,
    port: sourcePort,
    secrets: copiedSecrets,
    dashboardOperator: operator,
  });
  for (const key of ALLOWED_ENV_KEYS) if (sourceEnv[key] !== undefined) targetEnv[key] = sourceEnv[key];
  Object.assign(targetEnv, {
    OR3_VERSION: release.or3Version,
    OR3_IMAGE: image,
    OR3_COMPOSE_PROJECT: composeProjectNames(targetDirectory).project,
    OR3_VOLUME_NAME: composeProjectNames(targetDirectory).volume,
    OR3_CADDY_DATA_VOLUME: composeProjectNames(targetDirectory).caddyData,
    OR3_CADDY_CONFIG_VOLUME: composeProjectNames(targetDirectory).caddyConfig,
    OR3_PORT: String(sourcePort),
    OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite',
    OR3_SQLITE_DB_PATH: '/data/sync.sqlite',
    OR3_STORAGE_FS_ROOT: '/data/storage',
    OR3_PUBLIC_DOMAIN: domain ?? 'localhost',
    OR3_ALLOWED_ORIGINS: mode === 'public' ? `https://${domain}` : `http://127.0.0.1:${sourcePort}`,
    OR3_FORCE_HTTPS: mode === 'public' ? 'true' : 'false',
    OR3_TRUST_PROXY: mode === 'public' ? 'true' : 'false',
    OR3_AUTH_REGISTRATION_MODE: 'invite_only',
    OR3_AUTH_AUTO_PROVISION: 'false',
    OR3_GUEST_ACCESS_ENABLED: 'false',
  });
  await writeSecure(deploymentPaths(targetDirectory).env, serializeEnv(targetEnv));
  await writeSecure(join(targetDirectory, '.or3-initial-credentials'), serializeInitialCredentials({
    bootstrapEmail: email,
    bootstrapPassword: password,
    adminUsername: targetEnv.OR3_ADMIN_USERNAME,
    adminPassword: targetEnv.OR3_ADMIN_PASSWORD,
  }));
  const state = stateFromEnv(targetDirectory, targetEnv, mode, 'adopt', digest);
  const sourceBackupId = id('backup-adopt-source');
  const sourceBackupDir = backupDirectory(targetDirectory, sourceBackupId);
  await markPending(targetDirectory, state, {
    id: id('adopt'),
    operation: 'adopt',
    startedAt: now(),
    message: `Adopting ${sourceDirectory}`,
    sourceDirectory,
    sourceInitiallyRunning,
    backupId: sourceBackupId,
    backupPath: sourceBackupDir,
    phase: 'prepared',
  });
  let sourceStopAttempted = false;
  try {
    sourceStopAttempted = true;
    const sourceStop = await run('docker', [...sourceComposeArgs(sourceDirectory, sourceComposeFiles), 'stop'], sourceDirectory);
    if (!sourceStop.ok) throw new Error(`Could not stop the V1 deployment. ${redact(sourceStop.stderr, secretValues(sourceEnv))}`);
    const localDockerDaemon = await dockerDaemonIsLocal();
    if (localDockerDaemon && !await portAvailable(Number(targetEnv.OR3_PORT))) throw new Error(`Port ${targetEnv.OR3_PORT} is still in use after stopping the V1 deployment.`);
    if (mode === 'public' && localDockerDaemon) {
      for (const publicPort of [80, 443]) {
        if (!await portAvailable(publicPort)) throw new Error(`Public port ${publicPort} is still in use after stopping the V1 deployment.`);
      }
    }
    await mkdir(sourceBackupDir, { recursive: true, mode: 0o700 });
    await copySecure(join(sourceDirectory, '.env'), join(sourceBackupDir, 'config.env'));
    await archiveExternalVolume(sourceImage, sourceVolume, sourceBackupDir);
    const sourceManifest: BackupManifest = {
      schemaVersion: 1,
      backupId: sourceBackupId,
      createdAt: now(),
      appVersion: release.or3Version,
      image,
      imageDigest: digest,
      dataSha256: await sha256File(join(sourceBackupDir, 'data.tgz')),
      configSha256: await sha256File(join(sourceBackupDir, 'config.env')),
      mode,
      domain,
      composeProject: sourceEnv.OR3_COMPOSE_PROJECT ?? sanitizeName(basename(sourceDirectory)),
      volumeName: sourceVolume,
      caddyDataVolume: sourceEnv.OR3_CADDY_DATA_VOLUME,
      caddyConfigVolume: sourceEnv.OR3_CADDY_CONFIG_VOLUME,
      port: sourcePort,
    };
    const sourceManifestContents = `${JSON.stringify(sourceManifest, null, 2)}\n`;
    await writeSecure(join(sourceBackupDir, 'manifest.json'), sourceManifestContents);
    await writeBackupAuthentication(targetDirectory, sourceBackupDir, sourceManifestContents);
    await readManifest(sourceBackupDir, targetDirectory);
    await updatePending(targetDirectory, state, { phase: 'snapshot-created' });
    await restoreVolumeArchive(targetDirectory, mode, targetEnv, sourceBackupDir);
    await startProject(targetDirectory, mode, targetEnv);
    await provisionManagedCredentials(
      mode === 'public' ? new URL(`https://${domain}`) : new URL(`http://127.0.0.1:${sourcePort}`),
      email,
      password,
      targetEnv.OR3_ADMIN_USERNAME,
      targetEnv.OR3_ADMIN_PASSWORD,
    );
    const runtimeEnv = withoutProvisioningCredentials(targetEnv);
    await writeSecure(deploymentPaths(targetDirectory).env, serializeEnv(runtimeEnv));
    await stopProject(targetDirectory, mode);
    await startProject(targetDirectory, mode, runtimeEnv);
    await clearPending(targetDirectory, state);
    console.log(`Adopted ${sourceDirectory} into ${targetDirectory} at OR3 ${release.or3Version}.`);
    console.log(`Source backup: ${sourceBackupDir}`);
    console.log(`The original deployment is preserved and stopped. Verify sign-in, chat, and file access before removing anything.`);
  } catch (error) {
    await compose(targetDirectory, mode, ['down']).catch(() => undefined);
    let sourceRecoveryError = '';
    if (sourceStopAttempted && sourceInitiallyRunning) {
      try {
        await restartSource(sourceDirectory, sourceComposeFiles, secretValues(sourceEnv));
      } catch (recovery) {
        sourceRecoveryError = ` Original deployment recovery failed: ${recovery instanceof Error ? recovery.message : String(recovery)}`;
      }
    }
    state.lastError = redact(`${error instanceof Error ? error.message : String(error)}${sourceRecoveryError}`, secretValues(targetEnv));
    await writeState(targetDirectory, state);
    throw new Error(`${state.lastError}\n${sourceRecoveryError ? 'The original V1 deployment needs manual recovery. ' : 'The original V1 deployment was restarted and deeply healthy. '}Managed files remain at ${targetDirectory}.${sourceBackupDir ? ` Source backup: ${sourceBackupDir}.` : ''}`);
  }
}
