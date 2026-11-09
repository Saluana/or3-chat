#!/usr/bin/env node
// Qualify the existing Basic/filesystem browser journey on a disposable local
// deployment. The release workflow supplies the separate loopback Caddy proxy.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBrowserProcess } from './browser-process.mjs';

const args = process.argv.slice(2);
const names = new Set(['--deployment', '--image', '--operator', '--profile', '--source-sha', '--run-id', '--candidate-digest', '--operator-digest', '--tarball', '--qualification-out']);
const flags = {};
for (let i = 0; i < args.length; i += 2) {
  const name = args[i];
  if (!names.has(name) || Object.hasOwn(flags, name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid browser qualification arguments.');
  flags[name] = args[i + 1];
}
const deployment = resolve(flags['--deployment'] ?? '');
const image = flags['--image']; const operator = flags['--operator'];
const sourceSha = flags['--source-sha']; const runId = flags['--run-id'];
const digest = flags['--candidate-digest']; const operatorDigest = flags['--operator-digest'];
const tarball = flags['--tarball']; const output = flags['--qualification-out'];
const repo = 'ghcr.io/saluana/or3-chat';
const candidate = /^[0-9a-f]{40}$/.test(sourceSha ?? '') && /^sha256:[0-9a-f]{64}$/.test(digest ?? '') && /^sha256:[0-9a-f]{64}$/.test(operatorDigest ?? '');
// The actual tag is source-qualified and both images must share its version.
const prefix = `${repo}:candidate-`;
const suffix = `-${sourceSha}@${digest}`;
const version = image?.startsWith(prefix) && image.endsWith(suffix) ? image.slice(prefix.length, -suffix.length) : '';
if (!candidate || !/^\d+\.\d+\.\d+$/.test(version) || operator !== `${repo}:candidate-operator-${version}-${sourceSha}@${operatorDigest}` || flags['--profile'] !== 'basic-sqlite-fs' || !/^\d+$/.test(runId ?? '') || !flags['--deployment'] || !tarball || !output) throw new Error('Browser qualification requires the pinned Basic candidate, operator, package and identity.');
// This journey creates and modifies user data. Limit it to the candidate path
// on an ephemeral Actions runner; do not use it against an existing install.
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP || await realpath(deployment) !== resolve(await realpath(process.env.RUNNER_TEMP), 'or3-cloud-candidate')) throw new Error('Browser qualification requires the disposable Actions candidate deployment.');

function command(executable, commandArgs) {
  return execFileSync(executable, commandArgs, { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 }).trim();
}
const sha = async () => createHash('sha256').update(await readFile(tarball)).digest('hex');
const tarballSha256 = await sha();
const packed = JSON.parse(command('tar', ['-xOf', tarball, 'package/package.json']));
if (packed.name !== '@or3/cloud' || packed.version !== version || packed.or3Cloud?.sourceRevision !== sourceSha || packed.or3Cloud?.imageDigest !== digest || packed.or3Cloud?.operatorImageDigest !== operatorDigest) throw new Error('Browser qualification package identity mismatch.');
const caddyCompose = command('tar', ['-xOf', tarball, 'package/assets/compose.public.yaml']);
const caddyImage = caddyCompose.match(/^\s*image:\s*(caddy:\S+@sha256:[0-9a-f]{64})\s*$/m)?.[1];
const caddyBytes = execFileSync('tar', ['-xOf', tarball, 'package/assets/Caddyfile'], { timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 });
if (!caddyImage || !process.env.OR3_SMOKE_CADDYFILE) throw new Error('Browser qualification requires the packaged proxy configuration.');

const compose = ['compose', '--project-directory', deployment, '--env-file', resolve(deployment, '.env'), '-f', resolve(deployment, 'compose.yaml'), '-f', resolve(deployment, 'compose.operator.yaml')];
const inspect = (id) => JSON.parse(command('docker', ['inspect', '--format', '{{json .}}', id]));
const imageMatches = (reference, expected) => reference === `${repo}@${expected}` || reference === (expected === digest ? image : operator);
const onlyPort = (service, target, port) => {
  const entries = service.NetworkSettings?.Ports?.[`${target}/tcp`];
  return Array.isArray(entries) && entries.length === 1 && entries[0].HostIp === '127.0.0.1' && entries[0].HostPort === port;
};
function basicProfile(container) {
  const entries = container.Config?.Env;
  if (!Array.isArray(entries)) return false;
  const env = {};
  for (const entry of entries) {
    if (typeof entry !== 'string' || !entry.includes('=')) return false;
    const index = entry.indexOf('='); const key = entry.slice(0, index);
    if (!key || Object.hasOwn(env, key)) return false;
    env[key] = entry.slice(index + 1);
  }
  const fixed = {
    AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'basic-auth', SSR_AUTH_ENABLED: 'true',
    OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true', OR3_SYNC_PROVIDER: 'sqlite',
    OR3_STORAGE_ENABLED: 'true', OR3_CLOUD_STORAGE_ENABLED: 'true', OR3_STORAGE_PROVIDER: 'fs',
    NUXT_PUBLIC_STORAGE_PROVIDER: 'fs', OR3_SQLITE_DRIVER: 'better-sqlite3',
    NUXT_AUTH_ENABLED: 'true', NUXT_AUTH_PROVIDER: 'basic-auth', NUXT_PUBLIC_AUTH_PROVIDER: 'basic-auth', NUXT_PUBLIC_SSR_AUTH_ENABLED: 'true',
    NUXT_SYNC_ENABLED: 'true', NUXT_PUBLIC_SYNC_ENABLED: 'true', NUXT_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_SYNC_PROVIDER: 'sqlite',
    NUXT_STORAGE_ENABLED: 'true', NUXT_PUBLIC_STORAGE_ENABLED: 'true', NUXT_STORAGE_PROVIDER: 'fs',
  };
  const ambiguous = /^(?:RUNTIME_CONFIG$|NUXT_(?:AUTH|SYNC|STORAGE|PUBLIC)$|NITRO_ENV_(?:PREFIX|EXPANSION)$|NITRO_(?:AUTH|SYNC|STORAGE|PUBLIC)(?:_|$))/;
  return !Object.keys(env).some((key) => ambiguous.test(key)) && Object.entries(fixed).every(([key, expected]) => env[key] === undefined || env[key] === expected) &&
    (env.OR3_AUTH_PROVIDER || env.AUTH_PROVIDER) === 'basic-auth' && env.SSR_AUTH_ENABLED === 'true' &&
    (env.OR3_CLOUD_SYNC_ENABLED || env.OR3_SYNC_ENABLED) === 'true' && env.OR3_SYNC_PROVIDER === 'sqlite' &&
    (env.OR3_CLOUD_STORAGE_ENABLED || env.OR3_STORAGE_ENABLED) === 'true' && (env.OR3_STORAGE_PROVIDER || env.NUXT_PUBLIC_STORAGE_PROVIDER) === 'fs';
}
async function observe() {
  const state = JSON.parse(await readFile(resolve(deployment, '.or3-cloud/state.json'), 'utf8'));
  if (![1, 2].includes(state.schemaVersion) || state.mode !== 'local' || state.appVersion !== version || state.imageDigest !== digest || !imageMatches(state.image, digest) || state.port !== 3017 || !state.deploymentId || !state.composeProject || state.incompleteOperation) throw new Error('Browser qualification deployment state mismatch.');
  const ids = ['or3', 'or3-operator'].map((service) => command('docker', [...compose, 'ps', '-q', service]));
  if (ids.some((id) => !id || /\s/.test(id)) || ids[0] === ids[1]) throw new Error('Browser qualification cannot identify both running services.');
  const app = inspect(ids[0]); const sidecar = inspect(ids[1]); const proxy = inspect('or3-candidate-caddy');
  if (!basicProfile(app)) throw new Error('Browser qualification effective provider profile mismatch.');
  for (const [container, expected] of [[app, digest], [sidecar, operatorDigest]]) {
    if (!container.State?.Running || !imageMatches(container.Config?.Image, expected) || container.Config?.Labels?.['io.or3.cloud.deployment-id'] !== state.deploymentId || container.Config?.Labels?.['com.docker.compose.project'] !== state.composeProject) throw new Error('Browser qualification running image identity mismatch.');
  }
  const appNetworks = new Set(Object.values(app.NetworkSettings?.Networks ?? {}).map((n) => n.NetworkID));
  const proxyNetworks = Object.values(proxy.NetworkSettings?.Networks ?? {}).map((n) => n.NetworkID);
  const mounts = (proxy.Mounts ?? []).filter((mount) => mount.Destination === '/etc/caddy/Caddyfile');
  if (!proxy.State?.Running || proxy.Config?.Image !== caddyImage || mounts.length !== 1 || mounts[0].RW !== false || await realpath(mounts[0].Source) !== await realpath(process.env.OR3_SMOKE_CADDYFILE) || !(await readFile(mounts[0].Source)).equals(caddyBytes) || !onlyPort(app, 3000, '3017') || !onlyPort(proxy, 3018, '3018') || !proxyNetworks.some((network) => network && appNetworks.has(network))) throw new Error('Browser qualification proxy route mismatch.');
  for (const [ref, container] of [[image, app], [operator, sidecar], [caddyImage, proxy]]) {
    const inspected = JSON.parse(command('docker', ['image', 'inspect', '--format', '{{json .}}', ref]));
    if (!inspected.Id || inspected.Id !== container.Image) throw new Error('Browser qualification container image ID mismatch.');
    const labels = inspected.Config?.Labels;
    if (ref !== caddyImage && (labels?.['org.opencontainers.image.revision'] !== sourceSha || labels?.['org.opencontainers.image.version'] !== version)) throw new Error('Browser qualification image labels mismatch.');
  }
  const health = JSON.parse(command('docker', ['exec', ids[0], '/nodejs/bin/node', '-e', `fetch('http://127.0.0.1:3000/api/health?deep=true',{signal:AbortSignal.timeout(15000)}).then(async r => { if (!r.ok) process.exit(1); const h=await r.json(); console.log(JSON.stringify({status:h.status,providers:h.providers})); }).catch(()=>process.exit(1))`]));
  if (health.status !== 'ok' || health.providers?.auth?.provider !== 'basic-auth' || health.providers?.sync?.provider !== 'sqlite' || health.providers?.storage?.provider !== 'fs') throw new Error('Browser qualification deep-health provider mismatch.');
  if (!proxy.Id) throw new Error('Browser qualification proxy identity is missing.');
  return [...ids, proxy.Id];
}

const before = await observe();
const smoke = fileURLToPath(new URL('./smoke-browser.mjs', import.meta.url));
async function browser(url, hydrationOnly) {
  const env = { ...process.env, OR3_SMOKE_URL: url };
  env.OR3_SMOKE_ARTIFACT_DIR = resolve(process.env.OR3_SMOKE_ARTIFACT_DIR ?? 'output/browser-smoke', hydrationOnly ? 'proxy' : 'full');
  if (hydrationOnly) { env.OR3_SMOKE_HYDRATION_ONLY = '1'; delete env.OR3_SMOKE_SECURITY_ORIGIN; }
  else { delete env.OR3_SMOKE_HYDRATION_ONLY; env.OR3_SMOKE_SECURITY_ORIGIN = 'https://localhost:3018'; }
  const result = await runBrowserProcess(smoke, { cwd: deployment, env });
  if (result.timedOut || result.code !== 0) throw new Error('Browser qualification journey failed.');
}
await browser('https://localhost:3018', true);
await browser('http://127.0.0.1:3017', false);
const after = await observe();
if (before.some((id, index) => id !== after[index]) || await sha() !== tarballSha256) throw new Error('Browser qualification deployment or package changed during the journey.');
await writeFile(resolve(output), `${JSON.stringify({ schemaVersion: 1, profile: 'basic-sqlite-fs', check: 'browser', result: 'passed', sourceSha, workflowRunId: runId, candidateDigest: digest, operatorCandidateDigest: operatorDigest, tarballSha256 }, null, 2)}\n`, { flag: 'wx' });
console.log(`Wrote Basic browser qualification to ${output}`);
