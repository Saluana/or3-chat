#!/usr/bin/env node
// The candidate workflow's image and operator contract checks, with an
// optional two-profile evidence result. This does not promote either image.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [image, ...args] = process.argv.slice(2);
const names = new Set(['--operator', '--profile', '--source-sha', '--run-id', '--candidate-digest', '--operator-digest', '--qualification-out']);
const flags = {};
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  if (!names.has(name) || Object.hasOwn(flags, name) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Invalid image qualification arguments.');
  flags[name] = args[index + 1];
}
const profile = flags['--profile'];
const sourceSha = flags['--source-sha'];
const runId = flags['--run-id'];
const digest = flags['--candidate-digest'];
const operatorDigest = flags['--operator-digest'];
const operator = flags['--operator'];
const output = flags['--qualification-out'];
const suffix = profile === 'basic-sqlite-fs' ? '' : profile === 'clerk-sqlite-s3' ? 'clerk-s3-' : null;
const pattern = suffix !== null && /^[0-9a-f]{40}$/.test(sourceSha ?? '') && /^sha256:[0-9a-f]{64}$/.test(digest ?? '') && /^sha256:[0-9a-f]{64}$/.test(operatorDigest ?? '')
  ? new RegExp(`^ghcr\\.io/saluana/or3-chat:candidate-${suffix}(\\d+\\.\\d+\\.\\d+)-${sourceSha}@${digest}$`) : null;
const version = image?.match(pattern ?? /$a/)?.[1];
if (!version || operator !== `ghcr.io/saluana/or3-chat:candidate-operator-${version}-${sourceSha}@${operatorDigest}` || !/^\d+$/.test(runId ?? '') || !output) throw new Error('Image qualification requires pinned app and operator candidates with matching identity.');

function command(executable, commandArgs, container = false) {
  const name = container ? `or3-image-qualification-${randomUUID()}` : null;
  const actual = name ? [commandArgs[0], '--name', name, ...commandArgs.slice(1)] : commandArgs;
  const result = spawnSync(executable, actual, { encoding: 'utf8', timeout: 300_000, killSignal: 'SIGKILL' });
  if (result.error || result.status !== 0) {
    const cleanup = name ? spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' }) : null;
    throw new Error(`Image contract check failed: ${result.error?.message ?? result.stderr ?? ''}${cleanup && (cleanup.error || cleanup.status !== 0) ? `; container cleanup was not confirmed for ${name}` : ''}`);
  }
  return result.stdout.trim();
}

for (const [ref, expected] of [[image, digest], [operator, operatorDigest]]) {
  const inspected = command('docker', ['buildx', 'imagetools', 'inspect', ref.slice(0, ref.lastIndexOf('@'))]);
  const resolvedDigest = inspected.match(/^\s*Digest:\s*(sha256:[0-9a-f]{64})\s*$/m)?.[1];
  if (resolvedDigest !== expected || !/^\s*Platform:\s*linux\/amd64\s*$/m.test(inspected) || !/^\s*Platform:\s*linux\/arm64(?:\/v8)?\s*$/m.test(inspected)) throw new Error('Image contract digest or platform mismatch.');
}
for (const ref of [image, operator]) command('docker', ['pull', '--platform', 'linux/amd64', ref]);
for (const [ref, entrypoint] of [[image, '/nodejs/bin/node'], [operator, '/usr/local/bin/node']]) {
  if (command('docker', ['run', '--rm', '--platform', 'linux/amd64', '--entrypoint', entrypoint, ref, '--version'], true) !== process.version) throw new Error('Image Node version does not match the qualification runner.');
}
const previousVersion = command('npm', ['view', '@or3/cloud', 'version']);
if (!/^\d+\.\d+\.\d+$/.test(previousVersion)) throw new Error('Previous published Cloud version is invalid.');
const operatorProbe = `
install_dir=/tmp/operator-package-probe
mkdir -m 700 "$install_dir"
HOME="$install_dir" /usr/local/bin/docker manifest inspect "$1" >/dev/null
node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({private:true,dependencies:{"@or3/cloud":process.argv[2]}}))' "$install_dir/package.json" "$2"
cd "$install_dir"
HOME="$install_dir" NPM_CONFIG_CACHE="$install_dir/npm-cache" NPM_CONFIG_LOGLEVEL=error \\
  NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ NPM_CONFIG_IGNORE_SCRIPTS=true \\
  NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false \\
  NPM_CONFIG_USERCONFIG="$install_dir/disabled-user.npmrc" \\
  NPM_CONFIG_GLOBALCONFIG="$install_dir/disabled-global.npmrc" \\
  /usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js install \\
    --save-exact --package-lock=true --ignore-scripts --no-audit --no-fund
test "$(/usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js --version)" = 11.6.2`;
command('docker', ['run', '--rm', '--platform', 'linux/amd64', '--read-only', '--tmpfs', '/tmp:size=128m', '--user', '1001:1001', '--entrypoint', '/bin/sh', operator, '-ec', operatorProbe, '_', image, previousVersion], true);
await writeFile(resolve(output), `${JSON.stringify({ schemaVersion: 1, profile, check: 'imageContract', result: 'passed', sourceSha, workflowRunId: runId, candidateDigest: digest, operatorCandidateDigest: operatorDigest }, null, 2)}\n`, { flag: 'wx' });
console.log(`Wrote image contract qualification to ${output}`);
