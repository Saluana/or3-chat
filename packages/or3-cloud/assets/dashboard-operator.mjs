import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFile, chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const socketPath = process.env.OR3_DASHBOARD_OPERATOR_SOCKET || '/run/or3-operator/operator.sock';
const deploymentDirectory = process.cwd();
const cloudDirectory = join(deploymentDirectory, '.or3-cloud');
const jobPath = join(cloudDirectory, 'dashboard-update.json');
const releaseCheckPath = join(cloudDirectory, 'dashboard-update-check.json');
const auditPath = join(cloudDirectory, 'dashboard-update-audit.jsonl');
const statePath = join(cloudDirectory, 'state.json');
const leaseOwnerPath = join(cloudDirectory, 'operation-lease', 'owner.json');
const npmCli = '/usr/local/lib/node_modules/npm/bin/npm-cli.js';
const npmRequire = createRequire('/usr/local/lib/node_modules/npm/package.json');
const nodeBinary = '/usr/local/bin/node';
const registryOrigin = 'https://registry.npmjs.org';
const packageName = '@or3/cloud';
const expectedRepository = 'https://github.com/Saluana/or3-chat';
const expectedWorkflow = '.github/workflows/release-cloud.yml';
const stableVersion = /^\d+\.\d+\.\d+$/;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activePhases = new Set(['queued', 'running']);
const maxRegistryBytes = 256 * 1024;
const maxAttestationBytes = 1024 * 1024;
const maxProcessOutputBytes = 64 * 1024;
const maxUpdateDurationMs = 15 * 60 * 1000;
let updateClaimed = false;
const checkAttempts = [];
const startAttempts = [];
let auditQueue = Promise.resolve();

export function consumeRateLimit(attempts, now, limit, windowMs) {
  while (attempts.length && attempts[0] <= now - windowMs) attempts.shift();
  if (attempts.length >= limit) return false;
  attempts.push(now);
  return true;
}

function audit(event, details = {}) {
  auditQueue = auditQueue.then(async () => {
    await mkdir(cloudDirectory, { recursive: true, mode: 0o700 });
    try {
      if ((await stat(auditPath)).size >= 1024 * 1024) {
        await rm(`${auditPath}.previous`, { force: true });
        await rename(auditPath, `${auditPath}.previous`);
      }
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
    }
    await appendFile(auditPath, `${JSON.stringify({ ...details, at: new Date().toISOString(), event })}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await chmod(auditPath, 0o600);
  }).catch((error) => {
    console.error(`Could not append dashboard update audit event ${event}:`, error instanceof Error ? error.message : String(error));
  });
  return auditQueue;
}

function envValue(text, key) {
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) return undefined;
  const value = line.slice(key.length + 1).trim();
  return value.startsWith("'") && value.endsWith("'")
    ? value.slice(1, -1).replaceAll(/\\([\\'])/g, '$1')
    : value;
}

async function deploymentEnv() {
  return await readFile(join(deploymentDirectory, '.env'), 'utf8');
}

async function currentVersion() {
  return envValue(await deploymentEnv(), 'OR3_VERSION') || null;
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

async function readJob() {
  try {
    const job = JSON.parse(await readFile(jobPath, 'utf8'));
    if (!validDashboardUpdateJob(job)) throw new Error('The dashboard update job record is invalid.');
    return job;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw error;
  }
}

function exactKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key));
}

function validTimestamp(value) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

export function validDashboardUpdateJob(job) {
  if (!exactKeys(job, new Set(['id', 'targetVersion', 'phase', 'startedAt', 'completedAt', 'error']))) return false;
  return typeof job.id === 'string'
    && requestIdPattern.test(job.id)
    && typeof job.targetVersion === 'string'
    && stableVersion.test(job.targetVersion)
    && ['queued', 'running', 'succeeded', 'failed', 'needs_attention'].includes(job.phase)
    && validTimestamp(job.startedAt)
    && (job.completedAt === undefined || validTimestamp(job.completedAt))
    && (job.error === undefined || (typeof job.error === 'string' && job.error.length <= 4096));
}

function validSuccessfulCheck(value) {
  return exactKeys(value, new Set(['checkedAt', 'latestVersion', 'updateAvailable']))
    && validTimestamp(value.checkedAt)
    && typeof value.latestVersion === 'string'
    && stableVersion.test(value.latestVersion)
    && typeof value.updateAvailable === 'boolean';
}

export function validReleaseCheck(value) {
  return exactKeys(value, new Set(['schemaVersion', 'checkedAt', 'failure', 'incompatibilityReason', 'lastSuccessful']))
    && value.schemaVersion === 1
    && validTimestamp(value.checkedAt)
    && (value.failure === undefined || (typeof value.failure === 'string' && value.failure.length <= 4096))
    && (value.incompatibilityReason === undefined || (typeof value.incompatibilityReason === 'string' && value.incompatibilityReason.length <= 4096))
    && (value.lastSuccessful === undefined || validSuccessfulCheck(value.lastSuccessful));
}

async function readReleaseCheck() {
  try {
    const checked = JSON.parse(await readFile(releaseCheckPath, 'utf8'));
    if (!validReleaseCheck(checked)) throw new Error('The dashboard release-check record is invalid.');
    return checked;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeReleaseCheck(checked) {
  if (!validReleaseCheck(checked)) throw new Error('Refusing to persist an invalid dashboard release-check result.');
  await mkdir(dirname(releaseCheckPath), { recursive: true, mode: 0o700 });
  const temporary = `${releaseCheckPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await durableRename(temporary, releaseCheckPath);
}

async function durableRename(source, destination) {
  const file = await open(source, 'r');
  try { await file.sync(); } finally { await file.close(); }
  await rename(source, destination);
  const directory = await open(dirname(destination), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function writeJob(job) {
  const persisted = {
    ...job,
    ...(typeof job.error === 'string' ? { error: job.error.slice(0, 4096) } : {}),
  };
  if (!validDashboardUpdateJob(persisted)) throw new Error('Refusing to persist an invalid dashboard update job.');
  await mkdir(dirname(jobPath), { recursive: true, mode: 0o700 });
  const temporary = `${jobPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await durableRename(temporary, jobPath);
}

async function registryJson(url, maxBytes) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`The OR3 release service returned HTTP ${response.status}.`);
  if (new URL(response.url).origin !== registryOrigin) throw new Error('The OR3 release service returned an untrusted location.');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('The OR3 release response is too large.');
  if (!response.body) throw new Error('The OR3 release service returned an empty response.');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) throw new Error('The OR3 release response is too large.');
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch {
    throw new Error('The OR3 release service returned invalid JSON.');
  }
}

function exactRegistryUrl(value, expectedPath) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === registryOrigin && url.pathname.toLowerCase() === expectedPath.toLowerCase() && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function validSha512Integrity(value) {
  if (typeof value !== 'string' || !/^sha512-[A-Za-z0-9+/]+={2}$/.test(value)) return false;
  const encoded = value.slice('sha512-'.length);
  const digest = Buffer.from(encoded, 'base64');
  return digest.length === 64 && digest.toString('base64') === encoded;
}

async function release(requestedVersion) {
  const metadataPath = requestedVersion
    ? `/@or3%2fcloud/${encodeURIComponent(requestedVersion)}`
    : '/@or3%2fcloud/latest';
  const metadata = await registryJson(`${registryOrigin}${metadataPath}`, maxRegistryBytes);
  const version = typeof metadata?.version === 'string' ? metadata.version : '';
  const integrity = typeof metadata?.dist?.integrity === 'string' ? metadata.dist.integrity : '';
  const tarball = metadata?.dist?.tarball;
  const attestationUrl = metadata?.dist?.attestations?.url;
  const fileCount = metadata?.dist?.fileCount;
  const unpackedSize = metadata?.dist?.unpackedSize;
  const minimumSourceVersion = metadata?.or3Cloud?.dashboardUpdateMinimumSourceVersion;
  const operatorImageDigest = metadata?.or3Cloud?.operatorImageDigest;
  const sourceRevision = metadata?.or3Cloud?.sourceRevision;
  if (
    metadata?.name !== packageName
    || !stableVersion.test(version)
    || metadata?.or3Cloud?.dashboardUpdateProtocol !== 1
    || typeof minimumSourceVersion !== 'string'
    || !stableVersion.test(minimumSourceVersion)
    || typeof operatorImageDigest !== 'string'
    || !/^sha256:[0-9a-f]{64}$/.test(operatorImageDigest)
    || typeof sourceRevision !== 'string'
    || !/^[0-9a-f]{40}$/.test(sourceRevision)
    || !validSha512Integrity(integrity)
    || !exactRegistryUrl(tarball, `/@or3/cloud/-/cloud-${version}.tgz`)
    || !exactRegistryUrl(attestationUrl, `/-/npm/v1/attestations/@or3%2fcloud@${version}`)
    || metadata?.dist?.attestations?.provenance?.predicateType !== 'https://slsa.dev/provenance/v1'
    || !Number.isSafeInteger(fileCount)
    || fileCount < 1
    || fileCount > 32
    || !Number.isSafeInteger(unpackedSize)
    || unpackedSize < 1
    || unpackedSize > 2 * 1024 * 1024
  ) {
    throw new Error('The latest OR3 release is not a valid dashboard-update release.');
  }
  if (requestedVersion && version !== requestedVersion) {
    throw new Error(`The OR3 release service did not return the requested exact updater version ${requestedVersion}.`);
  }
  return { version, integrity, tarball, attestationUrl, minimumSourceVersion, operatorImageDigest, sourceRevision };
}

async function managedState() {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    if (!state || typeof state !== 'object' || state.schemaVersion !== 1) throw new Error();
    return state;
  } catch {
    throw new Error('The managed deployment state is unavailable or invalid.');
  }
}

async function assertUpdateReady() {
  const state = await managedState();
  if (state.incompleteOperation) {
    throw new Error('A managed operation needs recovery. Run `npx @or3/cloud recover` on the host before starting another update.');
  }
  return state;
}

async function status() {
  const version = await currentVersion();
  const [job, checked] = await Promise.all([readJob(), readReleaseCheck()]);
  return {
    kind: 'managed',
    enabled: true,
    currentVersion: version,
    checkedAt: checked?.checkedAt,
    latestVersion: checked?.lastSuccessful?.latestVersion,
    updateAvailable: checked?.lastSuccessful?.updateAvailable,
    checkError: checked?.failure,
    incompatibilityReason: checked?.incompatibilityReason,
    job: job ? {
      id: job.id,
      targetVersion: job.targetVersion,
      phase: job.phase,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
    } : null,
  };
}

async function check() {
  await assertUpdateReady();
  const previous = await readReleaseCheck();
  const checkedAt = new Date().toISOString();
  try {
    const [current, latest] = await Promise.all([currentVersion(), release()]);
    if (!current || !stableVersion.test(current)) throw new Error('The managed deployment does not have a valid current release version.');
    if (compareVersions(current, latest.minimumSourceVersion) < 0) {
      const incompatibilityReason = `OR3 ${latest.version} requires dashboard-update source version ${latest.minimumSourceVersion} or newer. Update once with the host CLI before using the dashboard bridge.`;
      await writeReleaseCheck({
        schemaVersion: 1,
        checkedAt,
        failure: incompatibilityReason,
        incompatibilityReason,
        lastSuccessful: previous?.lastSuccessful,
      });
      throw new Error(incompatibilityReason);
    }
    const lastSuccessful = {
      checkedAt,
      latestVersion: latest.version,
      updateAvailable: compareVersions(latest.version, current) > 0,
    };
    await writeReleaseCheck({ schemaVersion: 1, checkedAt, lastSuccessful });
    return await status();
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 4096);
    const persisted = await readReleaseCheck().catch(() => previous);
    if (persisted?.checkedAt !== checkedAt) {
      await writeReleaseCheck({
        schemaVersion: 1,
        checkedAt,
        failure: message,
        lastSuccessful: previous?.lastSuccessful,
      });
    }
    throw error;
  }
}

function updaterEnvironment(installDirectory, job, imageDigest) {
  return {
    ...process.env,
    HOME: installDirectory,
    NPM_CONFIG_CACHE: join(installDirectory, 'npm-cache'),
    NPM_CONFIG_LOGLEVEL: 'error',
    NPM_CONFIG_REGISTRY: `${registryOrigin}/`,
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_USERCONFIG: '/dev/null',
    NPM_CONFIG_GLOBALCONFIG: '/dev/null',
    OR3_DASHBOARD_UPDATE_JOB_ID: job.id,
    ...(imageDigest ? { OR3_EXPECTED_IMAGE_DIGEST: imageDigest } : {}),
  };
}

function runProcess(file, args, options) {
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const terminate = () => {
      if (!child.pid) return;
      if (process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGTERM');
          const force = setTimeout(() => {
            try { process.kill(-child.pid, 'SIGKILL'); } catch {}
          }, 5_000);
          force.unref();
          return;
        } catch {
          // The group may already be gone; fall back to the direct child.
        }
      }
      child.kill('SIGTERM');
    };
    const append = (chunk) => {
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output) > (options.maxOutputBytes || maxProcessOutputBytes)) {
        terminate();
        finish(new Error('The updater command returned too much output.'));
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => finish(undefined, { code, signal, output }));
    const timer = options.timeoutMs
      ? setTimeout(() => {
          terminate();
          finish(new Error('The updater command timed out.'));
        }, options.timeoutMs)
      : undefined;
    timer?.unref();
  });
}

export function provenanceStatement(payload, expectedRelease) {
  if (typeof payload !== 'string' || payload.length > maxAttestationBytes) throw new Error('The OR3 provenance payload is invalid.');
  let statement;
  try {
    statement = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    throw new Error('The OR3 provenance statement is invalid.');
  }
  const expectedRef = `refs/tags/v${expectedRelease.version}`;
  const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow;
  const subject = statement?.subject;
  const expectedDigest = Buffer.from(expectedRelease.integrity.slice('sha512-'.length), 'base64').toString('hex');
  const dependencies = statement?.predicate?.buildDefinition?.resolvedDependencies;
  if (
    expectedDigest.length !== 128
    || statement?._type !== 'https://in-toto.io/Statement/v1'
    || statement?.predicateType !== 'https://slsa.dev/provenance/v1'
    || !Array.isArray(subject)
    || subject.length !== 1
    || subject[0]?.name !== `pkg:npm/%40or3/cloud@${expectedRelease.version}`
    || subject[0]?.digest?.sha512 !== expectedDigest
    || workflow?.repository !== expectedRepository
    || workflow?.path !== expectedWorkflow
    || workflow?.ref !== expectedRef
    || statement?.predicate?.runDetails?.builder?.id !== 'https://github.com/actions/runner/github-hosted'
    || !Array.isArray(dependencies)
    || !dependencies.some((entry) => entry?.uri === `git+${expectedRepository}@${expectedRef}` && entry?.digest?.gitCommit === expectedRelease.sourceRevision)
  ) {
    throw new Error('The OR3 package provenance does not match the trusted release workflow.');
  }
  return statement;
}

async function trustedProvenance(expectedRelease) {
  const response = await registryJson(expectedRelease.attestationUrl, maxAttestationBytes);
  const provenance = Array.isArray(response?.attestations)
    ? response.attestations.filter((entry) => entry?.predicateType === 'https://slsa.dev/provenance/v1')
    : [];
  if (provenance.length !== 1) throw new Error('The OR3 package is missing its unique build provenance.');
  const bundle = provenance[0]?.bundle;
  const envelope = bundle?.dsseEnvelope;
  if (!Array.isArray(envelope?.signatures) || envelope.signatures.length !== 1 || typeof envelope.signatures[0]?.sig !== 'string') {
    throw new Error('The OR3 package provenance signature is invalid.');
  }
  // Verify the exact DSSE bundle that supplies the policy fields below. npm's
  // separate audit command verifies the installed tarball; it does not make a
  // second, unauthenticated registry response suitable policy input.
  let verify;
  try {
    ({ verify } = npmRequire('sigstore'));
  } catch {
    throw new Error('The operator runtime does not contain the Sigstore verifier required for dashboard updates.');
  }
  try {
    await verify(bundle, {
      tufCachePath: join('/tmp', 'or3-dashboard-sigstore'),
      tufForceCache: false,
    });
  } catch (error) {
    throw new Error(`The OR3 package provenance bundle could not be cryptographically verified: ${error instanceof Error ? error.message : String(error)}`);
  }
  provenanceStatement(envelope.payload, expectedRelease);
  return createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
}

async function verifyInstalledUpdater(installDirectory, expectedRelease, job, provenanceFingerprint) {
  const packageRoot = join(installDirectory, 'node_modules', '@or3', 'cloud');
  const [manifest, lock] = await Promise.all([
    readFile(join(packageRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(installDirectory, 'package-lock.json'), 'utf8').then(JSON.parse),
  ]);
  const dependencyGroups = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
  if (
    manifest?.name !== packageName
    || manifest?.version !== expectedRelease.version
    || manifest?.repository?.url !== 'git+https://github.com/Saluana/or3-chat.git'
    || manifest?.repository?.directory !== 'packages/or3-cloud'
    || manifest?.bin?.or3 !== './dist/cli.mjs'
    || manifest?.or3Cloud?.dashboardUpdateProtocol !== 1
    || !stableVersion.test(manifest?.or3Cloud?.dashboardUpdateMinimumSourceVersion || '')
    || !/^sha256:[0-9a-f]{64}$/.test(manifest?.or3Cloud?.imageDigest || '')
    || !/^sha256:[0-9a-f]{64}$/.test(manifest?.or3Cloud?.operatorImageDigest || '')
    || manifest?.or3Cloud?.sourceRevision !== expectedRelease.sourceRevision
    || dependencyGroups.some((key) => manifest?.[key] && Object.keys(manifest[key]).length)
  ) {
    throw new Error('The installed updater package does not match the trusted OR3 package contract.');
  }
  const locked = lock?.packages?.['node_modules/@or3/cloud'];
  const entries = Object.keys(lock?.packages || {}).sort();
  if (
    entries.length !== 2
    || entries[0] !== ''
    || entries[1] !== 'node_modules/@or3/cloud'
    || locked?.version !== expectedRelease.version
    || locked?.integrity !== expectedRelease.integrity
    || locked?.resolved !== expectedRelease.tarball
  ) {
    throw new Error('The installed updater package does not match the verified npm release.');
  }
  const audit = await runProcess(nodeBinary, [
    npmCli,
    'audit',
    'signatures',
    '--loglevel=notice',
    '--color=false',
  ], {
    cwd: installDirectory,
    env: updaterEnvironment(installDirectory, job),
    timeoutMs: 60_000,
  });
  if (
    audit.code !== 0
    || !audit.output.includes('audited 1 package')
    || !audit.output.includes('1 package has a verified registry signature')
    || !audit.output.includes('1 package has a verified attestation')
  ) {
    throw new Error('The updater package signature or provenance could not be verified.');
  }
  if (await trustedProvenance(expectedRelease) !== provenanceFingerprint) {
    throw new Error('The updater package provenance changed during verification.');
  }
  return {
    cli: join(packageRoot, 'dist', 'cli.mjs'),
    imageDigest: manifest.or3Cloud.imageDigest,
  };
}

async function withVerifiedUpdater(expectedRelease, job, action) {
  const installDirectory = join('/tmp', `or3-dashboard-update-${job.id}`);
  await rm(installDirectory, { recursive: true, force: true });
  await mkdir(installDirectory, { recursive: false, mode: 0o700 });
  try {
    const provenanceFingerprint = await trustedProvenance(expectedRelease);
    await writeFile(join(installDirectory, 'package.json'), `${JSON.stringify({
      private: true,
      dependencies: { [packageName]: expectedRelease.version },
    }, null, 2)}\n`, { mode: 0o600 });
    const installed = await runProcess(nodeBinary, [
      npmCli,
      'install',
      '--save-exact',
      '--package-lock=true',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ], {
      cwd: installDirectory,
      env: updaterEnvironment(installDirectory, job),
      timeoutMs: 120_000,
    });
    if (installed.code !== 0) throw new Error('The verified updater package could not be installed.');
    const updater = await verifyInstalledUpdater(installDirectory, expectedRelease, job, provenanceFingerprint);
    return await action(updater, installDirectory);
  } finally {
    await rm(installDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runUpdate(job) {
  const expectedRelease = await release();
  if (expectedRelease.version !== job.targetVersion) {
    throw new Error('The verified latest release changed before the update started. Check again.');
  }
  await withVerifiedUpdater(expectedRelease, job, async (updater, installDirectory) => {
    const updated = await runProcess(nodeBinary, [updater.cli, 'update', '--to', job.targetVersion], {
      cwd: deploymentDirectory,
      env: updaterEnvironment(installDirectory, job, updater.imageDigest),
      maxOutputBytes: 256 * 1024,
      timeoutMs: maxUpdateDurationMs,
    });
    if (updated.code !== 0) throw new Error('The managed updater did not complete successfully.');
  });
}

async function runRecovery(job) {
  const expectedRelease = await release(job.targetVersion);
  await withVerifiedUpdater(expectedRelease, job, async (updater, installDirectory) => {
    const recovered = await runProcess(nodeBinary, [updater.cli, 'recover'], {
      cwd: deploymentDirectory,
      env: updaterEnvironment(installDirectory, job, updater.imageDigest),
      maxOutputBytes: 256 * 1024,
      timeoutMs: maxUpdateDurationMs,
    });
    if (recovered.code !== 0) throw new Error('The exact dashboard updater could not recover the interrupted operation.');
  });
}

function closeAfter(server, code) {
  setTimeout(() => server.close(() => process.exit(code)), 250).unref();
}

/**
 * A dashboard-origin update cannot recreate its own container before the CLI
 * has committed terminal state. Once the job is durable, ask Docker to replace
 * only this sidecar from the newly written digest-qualified overlay. The
 * detached Docker client survives the current container's termination.
 */
function recreateOperatorAfterCommit(environment) {
  const project = envValue(environment, 'OR3_COMPOSE_PROJECT');
  if (!project) return;
  try {
    const child = spawn('docker', [
      'compose',
      '--project-name', project,
      '--project-directory', deploymentDirectory,
      '--env-file', join(deploymentDirectory, '.env'),
      '-f', join(deploymentDirectory, 'compose.yaml'),
      '-f', join(deploymentDirectory, 'compose.operator.yaml'),
      'up', '-d', '--no-deps', '--force-recreate', 'or3-operator',
    ], {
      cwd: deploymentDirectory,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // The durable terminal job and restart policy still leave a host-CLI
    // recovery path if Docker cannot schedule the sidecar replacement.
  }
}

async function finish(server, job, error) {
  job.phase = error ? 'failed' : 'succeeded';
  job.completedAt = new Date().toISOString();
  if (error) job.error = error instanceof Error ? error.message : 'The update did not complete. OR3 restored the previous verified deployment when possible.';
  await writeJob(job);
  await audit(error ? 'update_failed' : 'update_succeeded', { jobId: job.id, targetVersion: job.targetVersion });
  // A successful run restarts this narrowly scoped service so it reloads the
  // just-installed operator program. Failed first-time enablement exits cleanly
  // because the restored .env no longer declares the profile.
  let enabled = true;
  try {
    const environment = await deploymentEnv();
    enabled = envValue(environment, 'OR3_DASHBOARD_UPDATES_ENABLED') === 'true';
    if (enabled) recreateOperatorAfterCommit(environment);
  } catch {
    // Keep the service restart-on-failure behavior when state cannot be read.
  }
  // A disabled bridge must stay down after a host update/restore. When it is
  // still enabled, restart the sidecar so Docker recreates it from the just
  // committed digest-qualified overlay and reloads the operator asset.
  closeAfter(server, enabled ? 75 : 0);
}

async function reconcileInterruptedJob() {
  const job = await readJob();
  if (!job || !activePhases.has(job.phase)) return;
  let state;
  try {
    state = await managedState();
  } catch (error) {
    job.phase = 'needs_attention';
    job.error = error instanceof Error ? error.message : 'The managed deployment state needs attention.';
    await writeJob(job);
    return;
  }
  if (state.incompleteOperation) {
    const pending = state.incompleteOperation;
    if (
      pending.operation !== 'update'
      || pending.origin !== 'dashboard'
      || pending.dashboardJobId !== job.id
      || pending.targetVersion !== job.targetVersion
    ) {
      job.phase = 'needs_attention';
      job.completedAt = new Date().toISOString();
      job.error = 'A different or unowned managed operation is incomplete. It was left for host-CLI recovery.';
      await writeJob(job);
      return;
    }
    let activeLease = false;
    try {
      const owner = JSON.parse(await readFile(leaseOwnerPath, 'utf8'));
      const heartbeat = Date.parse(owner?.heartbeatAt || '');
      activeLease = owner?.origin === 'dashboard'
        && owner?.jobId === job.id
        && Number.isFinite(heartbeat)
        && Date.now() - heartbeat <= 30_000;
    } catch {
      // An absent lease is expected after a container/process interruption.
    }
    if (activeLease) {
      const retry = setTimeout(() => { void reconcileInterruptedJob(); }, 5_000);
      retry.unref();
      return;
    }
    try {
      job.phase = 'running';
      delete job.error;
      await writeJob(job);
      await runRecovery(job);
      state = await managedState();
      if (state.incompleteOperation) throw new Error('The exact updater returned while its lifecycle journal remained incomplete.');
      job.completedAt = new Date().toISOString();
      if (state.appVersion === job.targetVersion) {
        job.phase = 'succeeded';
      } else {
        job.phase = 'failed';
        job.error = `The interrupted update was safely restored to OR3 ${state.appVersion}.`;
      }
    } catch (error) {
      job.phase = 'needs_attention';
      job.completedAt = new Date().toISOString();
      job.error = error instanceof Error ? error.message : 'The dashboard updater could not automatically recover its interrupted operation.';
    }
  } else if (state.appVersion === job.targetVersion) {
    job.phase = 'succeeded';
    job.completedAt = new Date().toISOString();
    delete job.error;
  } else {
    job.phase = 'failed';
    job.completedAt = new Date().toISOString();
    job.error = 'The update process stopped before completion. The managed deployment did not switch to the requested release.';
  }
  await writeJob(job);
}

function send(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(`${JSON.stringify(body)}\n`);
}

async function body(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > 4096) throw new Error('Request body is too large.');
    chunks.push(bytes);
  }
  try {
    return total ? JSON.parse(Buffer.concat(chunks, total).toString('utf8')) : {};
  } catch {
    throw new Error('Request body is not valid JSON.');
  }
}

export function validStartInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const keys = Object.keys(input).sort();
  return keys.length === 2
    && keys[0] === 'requestId'
    && keys[1] === 'targetVersion'
    && typeof input.requestId === 'string'
    && requestIdPattern.test(input.requestId)
    && typeof input.targetVersion === 'string'
    && stableVersion.test(input.targetVersion);
}

async function main() {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  await rm(socketPath, { force: true });

  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/status') return send(response, 200, await status());
      if (request.method === 'POST' && request.url === '/check') {
        if (!consumeRateLimit(checkAttempts, Date.now(), 30, 60_000)) {
          await audit('check_rate_limited');
          return send(response, 429, { message: 'Release checks are temporarily rate limited.' });
        }
        const checked = await check();
        await audit('release_checked', { latestVersion: checked.latestVersion, updateAvailable: checked.updateAvailable });
        return send(response, 200, checked);
      }
      if (request.method === 'POST' && request.url === '/start') {
        if (!consumeRateLimit(startAttempts, Date.now(), 6, 60_000)) {
          await audit('start_rate_limited');
          return send(response, 429, { message: 'Update starts are temporarily rate limited.' });
        }
        const input = await body(request);
        if (!validStartInput(input)) {
          await audit('start_rejected_invalid');
          return send(response, 400, { message: 'A valid update request is required.' });
        }
        if (updateClaimed) {
          await audit('start_rejected_busy', { requestId: input.requestId, targetVersion: input.targetVersion });
          return send(response, 409, { message: 'An update is already starting or running.' });
        }
        updateClaimed = true;
        try {
          const checked = await check();
          if (!checked.updateAvailable) {
            updateClaimed = false;
            await audit('start_rejected_no_update', { requestId: input.requestId, targetVersion: input.targetVersion });
            return send(response, 409, { message: 'No newer supported release is available.' });
          }
          if (input.targetVersion !== checked.latestVersion) {
            updateClaimed = false;
            await audit('start_rejected_stale_target', { requestId: input.requestId, targetVersion: input.targetVersion });
            return send(response, 409, { message: 'The requested version is no longer the verified latest release. Check again.' });
          }
          const previous = await readJob();
          if (previous && activePhases.has(previous.phase)) {
            updateClaimed = false;
            if (previous.id === input.requestId) {
              await audit('start_replayed', { jobId: previous.id, targetVersion: previous.targetVersion });
              return send(response, 202, { ...checked, job: previous });
            }
            await audit('start_rejected_busy', { requestId: input.requestId, targetVersion: input.targetVersion });
            return send(response, 409, { message: 'An update is already running.' });
          }
          const job = {
            id: input.requestId,
            targetVersion: checked.latestVersion,
            phase: 'queued',
            startedAt: new Date().toISOString(),
          };
          await writeJob(job);
          await audit('update_accepted', { jobId: job.id, targetVersion: job.targetVersion });
          send(response, 202, { ...checked, job });
          queueMicrotask(async () => {
            try {
              job.phase = 'running';
              await writeJob(job);
              await runUpdate(job);
              await finish(server, job);
            } catch (error) {
              await finish(server, job, error).catch(() => closeAfter(server, 75));
            }
          });
          return;
        } catch (error) {
          updateClaimed = false;
          throw error;
        }
      }
      send(response, 404, { message: 'Not found.' });
    } catch (error) {
      send(response, 503, { message: error instanceof Error ? error.message : 'The update operator is unavailable.' });
    }
  });

  server.listen(socketPath, () => {
    // The read-only app bind mount needs to connect as a distinct container UID.
    // The socket exposes only these three fixed operations, never Docker itself.
    // The app gets a supplementary group matching the deployment owner's
    // primary group. Keep the privileged control socket out of world-writable
    // reach while allowing that app group to connect.
    void chmod(socketPath, 0o660).catch(() => closeAfter(server, 1));
    void reconcileInterruptedJob().catch(async (error) => {
      const job = await readJob();
      if (!job || !activePhases.has(job.phase)) return;
      job.phase = 'needs_attention';
      job.completedAt = new Date().toISOString();
      job.error = error instanceof Error ? error.message : 'The dashboard updater could not inspect its interrupted operation.';
      await writeJob(job);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
