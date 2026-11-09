#!/usr/bin/env node
// Identity boundaries for the candidate workflow. Successful mandatory
// workflow steps, not this finalizer, establish the lifecycle sequence.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [action, ...args] = process.argv.slice(2);
const names = new Set(['--deployment', '--image', '--operator', '--source-sha', '--run-id', '--previous-version', '--candidate-digest', '--operator-digest', '--tarball', '--inputs', '--baseline', '--browser', '--qualification-out']);
const flags = {};
for (let i = 0; i < args.length; i += 2) {
  if (!names.has(args[i]) || Object.hasOwn(flags, args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid lifecycle evidence arguments.');
  flags[args[i]] = args[i + 1];
}
if (!['begin', 'baseline', 'assert-baseline', 'finish'].includes(action) || [...names].some((name) => !flags[name])) throw new Error('Incomplete lifecycle evidence arguments.');
const sourceSha = flags['--source-sha'], workflowRunId = flags['--run-id'];
const previousVersion = flags['--previous-version'];
const candidateDigest = flags['--candidate-digest'], operatorCandidateDigest = flags['--operator-digest'];
const image = flags['--image'], operator = flags['--operator'], tarball = resolve(flags['--tarball']);
const deployment = resolve(flags['--deployment']), repo = 'ghcr.io/saluana/or3-chat';
const match = image.match(/^ghcr\.io\/saluana\/or3-chat:candidate-(\d+\.\d+\.\d+)-([0-9a-f]{40})@(sha256:[0-9a-f]{64})$/);
const version = match?.[1];
if (!match || match[2] !== sourceSha || match[3] !== candidateDigest || !/^sha256:[0-9a-f]{64}$/.test(operatorCandidateDigest) || operator !== `${repo}:candidate-operator-${version}-${sourceSha}@${operatorCandidateDigest}` || !/^\d+$/.test(workflowRunId) || !/^\d+\.\d+\.\d+$/.test(previousVersion) || previousVersion === version) throw new Error('Invalid lifecycle candidate or baseline identity.');
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP || await realpath(deployment) !== resolve(await realpath(process.env.RUNNER_TEMP), 'or3-cloud-candidate')) throw new Error('Lifecycle evidence requires the disposable Actions candidate deployment.');
const command = (exe, argv) => execFileSync(exe, argv, { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 }).trim();
const sha = async () => createHash('sha256').update(await readFile(tarball)).digest('hex');
const inputs = { sourceSha, workflowRunId, candidateDigest, operatorCandidateDigest, image, operator, version, previousVersion, tarballSha256: await sha() };
const inputPath = resolve(flags['--inputs']), baselinePath = resolve(flags['--baseline']);
if (action === 'begin') {
  const packed = JSON.parse(command('tar', ['-xOf', tarball, 'package/package.json']));
  if (packed.name !== '@or3/cloud' || packed.version !== version || packed.or3Cloud?.sourceRevision !== sourceSha || packed.or3Cloud?.imageDigest !== candidateDigest || packed.or3Cloud?.operatorImageDigest !== operatorCandidateDigest) throw new Error('Lifecycle package identity mismatch.');
  await writeFile(inputPath, JSON.stringify(inputs), { flag: 'wx', mode: 0o600 });
  process.exit(0);
}
if (JSON.stringify(JSON.parse(await readFile(inputPath, 'utf8'))) !== JSON.stringify(inputs)) throw new Error('Lifecycle inputs changed.');
const state = JSON.parse(await readFile(resolve(deployment, '.or3-cloud/state.json'), 'utf8'));
if (![1, 2].includes(state.schemaVersion) || state.mode !== 'local' || state.port !== 3017 || !state.deploymentId || !state.composeProject || state.incompleteOperation) throw new Error('Lifecycle deployment state mismatch.');
const compose = ['compose', '--project-directory', deployment, '--env-file', resolve(deployment, '.env'), '-f', resolve(deployment, 'compose.yaml'), '-f', resolve(deployment, 'compose.operator.yaml')];
const ids = ['or3', 'or3-operator'].map((service) => command('docker', [...compose, 'ps', '-q', service]));
if (ids.some((id) => !id || /\s/.test(id)) || ids[0] === ids[1]) throw new Error('Lifecycle services are missing.');
const containers = ids.map((id) => JSON.parse(command('docker', ['inspect', '--format', '{{json .}}', id])));
for (const container of containers) {
  if (!container.State?.Running || !container.Image || !container.Config?.Image || container.Config?.Labels?.['io.or3.cloud.deployment-id'] !== state.deploymentId || container.Config?.Labels?.['com.docker.compose.project'] !== state.composeProject) throw new Error('Lifecycle service identity mismatch.');
}
const health = JSON.parse(command('docker', ['exec', ids[0], '/nodejs/bin/node', '-e', `fetch('http://127.0.0.1:3000/api/health?deep=true',{signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)process.exit(1);const h=await r.json();console.log(JSON.stringify({status:h.status,providers:h.providers}))}).catch(()=>process.exit(1))`]));
if (health.status !== 'ok' || health.providers?.auth?.provider !== 'basic-auth' || health.providers?.sync?.provider !== 'sqlite' || health.providers?.storage?.provider !== 'fs') throw new Error('Lifecycle provider health mismatch.');
function baselineObservation() {
  const pinned = (ref, tag) => {
    if (typeof ref !== 'string') return null;
    const prefix = ref.startsWith(`${repo}@`) ? `${repo}@` : ref.startsWith(`${repo}:${tag}@`) ? `${repo}:${tag}@` : '';
    const digest = prefix && ref.slice(prefix.length);
    return /^sha256:[0-9a-f]{64}$/.test(digest) ? digest : null;
  };
  const appDigest = pinned(containers[0].Config.Image, previousVersion);
  const operatorDigest = pinned(containers[1].Config.Image, `${previousVersion}-operator`);
  if (state.appVersion !== previousVersion || !appDigest || !operatorDigest || state.imageDigest !== appDigest || pinned(state.image, previousVersion) !== appDigest) throw new Error('Lifecycle baseline image mismatch.');
  for (const container of containers) {
    const inspected = JSON.parse(command('docker', ['image', 'inspect', '--format', '{{json .}}', container.Config.Image]));
    if (inspected.Id !== container.Image) throw new Error('Lifecycle baseline image ID mismatch.');
  }
  return { deploymentId: state.deploymentId, composeProject: state.composeProject, appVersion: state.appVersion, imageDigest: appDigest, services: containers.map((container, index) => ({ digest: index === 0 ? appDigest : operatorDigest, imageId: container.Image })) };
}
if (action === 'baseline') {
  await writeFile(baselinePath, JSON.stringify(baselineObservation()), { flag: 'wx', mode: 0o600 });
  process.exit(0);
}
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
if (action === 'assert-baseline') {
  if (JSON.stringify(baselineObservation()) !== JSON.stringify(baseline)) throw new Error('Lifecycle restored baseline identity mismatch.');
  process.exit(0);
}
if (state.deploymentId !== baseline.deploymentId || state.composeProject !== baseline.composeProject || state.appVersion !== version || state.imageDigest !== candidateDigest || ![`${repo}@${candidateDigest}`, image].includes(state.image)) throw new Error('Lifecycle final deployment mismatch.');
for (const [index, ref, digest] of [[0, image, candidateDigest], [1, operator, operatorCandidateDigest]]) {
  if (![`${repo}@${digest}`, ref].includes(containers[index].Config.Image)) throw new Error('Lifecycle final running image mismatch.');
  const inspected = JSON.parse(command('docker', ['image', 'inspect', '--format', '{{json .}}', ref]));
  if (inspected.Id !== containers[index].Image || inspected.Config?.Labels?.['org.opencontainers.image.revision'] !== sourceSha || inspected.Config?.Labels?.['org.opencontainers.image.version'] !== version) throw new Error('Lifecycle final image labels mismatch.');
}
const expected = { schemaVersion: 1, profile: 'basic-sqlite-fs', check: 'browser', result: 'passed', sourceSha, workflowRunId, candidateDigest, operatorCandidateDigest, tarballSha256: inputs.tarballSha256 };
const browser = JSON.parse(await readFile(resolve(flags['--browser']), 'utf8'));
if (Object.keys(browser).length !== Object.keys(expected).length || Object.entries(expected).some(([key, value]) => browser[key] !== value)) throw new Error('Lifecycle browser evidence mismatch.');
await writeFile(resolve(flags['--qualification-out']), `${JSON.stringify({ ...expected, check: 'lifecycle' }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
