import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const socketPath = process.env.OR3_DASHBOARD_OPERATOR_SOCKET || '/run/or3-operator/operator.sock';
const deploymentDirectory = process.cwd();
const cloudDirectory = join(deploymentDirectory, '.or3-cloud');
const jobPath = join(cloudDirectory, 'dashboard-update.json');
const statePath = join(cloudDirectory, 'state.json');
const npmCli = '/usr/local/lib/node_modules/npm/bin/npm-cli.js';
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
let updateClaimed = false;

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
    return JSON.parse(await readFile(jobPath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJob(job) {
  await mkdir(dirname(jobPath), { recursive: true, mode: 0o700 });
  const temporary = `${jobPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, jobPath);
  await chmod(jobPath, 0o600);
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

async function release() {
  const metadata = await registryJson(`${registryOrigin}/@or3%2fcloud/latest`, maxRegistryBytes);
  const version = typeof metadata?.version === 'string' ? metadata.version : '';
  const integrity = typeof metadata?.dist?.integrity === 'string' ? metadata.dist.integrity : '';
  const tarball = metadata?.dist?.tarball;
  const attestationUrl = metadata?.dist?.attestations?.url;
  const fileCount = metadata?.dist?.fileCount;
  const unpackedSize = metadata?.dist?.unpackedSize;
  if (
    metadata?.name !== packageName
    || !stableVersion.test(version)
    || metadata?.or3Cloud?.dashboardUpdateProtocol !== 1
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
  return { version, integrity, tarball, attestationUrl };
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
  const job = await readJob();
  return {
    kind: 'managed',
    enabled: true,
    currentVersion: version,
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
  const [current, latest] = await Promise.all([currentVersion(), release()]);
  if (!current || !stableVersion.test(current)) throw new Error('The managed deployment does not have a valid current release version.');
  return {
    ...(await status()),
    latestVersion: latest.version,
    updateAvailable: compareVersions(latest.version, current) > 0,
  };
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
    const append = (chunk) => {
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output) > (options.maxOutputBytes || maxProcessOutputBytes)) {
        child.kill('SIGKILL');
        finish(new Error('The updater command returned too much output.'));
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => finish(undefined, { code, signal, output }));
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
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
    || !dependencies.some((entry) => entry?.uri === `git+${expectedRepository}@${expectedRef}` && /^[0-9a-f]{40}$/.test(entry?.digest?.gitCommit || ''))
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
  const envelope = provenance[0]?.bundle?.dsseEnvelope;
  if (!Array.isArray(envelope?.signatures) || envelope.signatures.length !== 1 || typeof envelope.signatures[0]?.sig !== 'string') {
    throw new Error('The OR3 package provenance signature is invalid.');
  }
  provenanceStatement(envelope.payload, expectedRelease);
  return JSON.stringify({ payload: envelope.payload, signatures: envelope.signatures });
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
    || !/^sha256:[0-9a-f]{64}$/.test(manifest?.or3Cloud?.imageDigest || '')
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
  const audit = await runProcess('/nodejs/bin/node', [
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

async function runUpdate(job) {
  const expectedRelease = await release();
  if (expectedRelease.version !== job.targetVersion) {
    throw new Error('The verified latest release changed before the update started. Check again.');
  }
  const installDirectory = join('/tmp', `or3-dashboard-update-${job.id}`);
  await rm(installDirectory, { recursive: true, force: true });
  await mkdir(installDirectory, { recursive: false, mode: 0o700 });
  try {
    const provenanceFingerprint = await trustedProvenance(expectedRelease);
    await writeFile(join(installDirectory, 'package.json'), `${JSON.stringify({
      private: true,
      dependencies: { [packageName]: expectedRelease.version },
    }, null, 2)}\n`, { mode: 0o600 });
    const installed = await runProcess('/nodejs/bin/node', [
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
    const updated = await runProcess('/nodejs/bin/node', [updater.cli, 'update', '--to', job.targetVersion], {
      cwd: deploymentDirectory,
      env: updaterEnvironment(installDirectory, job, updater.imageDigest),
      maxOutputBytes: 256 * 1024,
    });
    if (updated.code !== 0) throw new Error('The managed updater did not complete successfully.');
  } finally {
    await rm(installDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function closeAfter(server, code) {
  setTimeout(() => server.close(() => process.exit(code)), 250).unref();
}

async function finish(server, job, error) {
  job.phase = error ? 'failed' : 'succeeded';
  job.completedAt = new Date().toISOString();
  if (error) job.error = error instanceof Error ? error.message : 'The update did not complete. OR3 restored the previous verified deployment when possible.';
  await writeJob(job);
  // A successful run restarts this narrowly scoped service so it reloads the
  // just-installed operator program. Failed first-time enablement exits cleanly
  // because the restored .env no longer declares the profile.
  let enabled = true;
  try {
    enabled = envValue(await deploymentEnv(), 'OR3_DASHBOARD_UPDATES_ENABLED') === 'true';
  } catch {
    // Keep the service restart-on-failure behavior when state cannot be read.
  }
  closeAfter(server, !error || enabled ? 75 : 0);
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
  job.completedAt = new Date().toISOString();
  if (state.incompleteOperation) {
    job.phase = 'needs_attention';
    job.error = 'The update was interrupted. Run `npx @or3/cloud recover` on the host, then check again.';
  } else if (state.appVersion === job.targetVersion) {
    job.phase = 'succeeded';
    delete job.error;
  } else {
    job.phase = 'failed';
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
  await reconcileInterruptedJob();

  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/status') return send(response, 200, await status());
      if (request.method === 'POST' && request.url === '/check') return send(response, 200, await check());
      if (request.method === 'POST' && request.url === '/start') {
        const input = await body(request);
        if (!validStartInput(input)) return send(response, 400, { message: 'A valid update request is required.' });
        if (updateClaimed) return send(response, 409, { message: 'An update is already starting or running.' });
        updateClaimed = true;
        try {
          const checked = await check();
          if (!checked.updateAvailable) {
            updateClaimed = false;
            return send(response, 409, { message: 'No newer supported release is available.' });
          }
          if (input.targetVersion !== checked.latestVersion) {
            updateClaimed = false;
            return send(response, 409, { message: 'The requested version is no longer the verified latest release. Check again.' });
          }
          const previous = await readJob();
          if (previous && activePhases.has(previous.phase)) {
            updateClaimed = false;
            if (previous.id === input.requestId) return send(response, 202, { ...checked, job: previous });
            return send(response, 409, { message: 'An update is already running.' });
          }
          const job = {
            id: input.requestId,
            targetVersion: checked.latestVersion,
            phase: 'queued',
            startedAt: new Date().toISOString(),
          };
          await writeJob(job);
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
    void chmod(socketPath, 0o666).catch(() => closeAfter(server, 1));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
