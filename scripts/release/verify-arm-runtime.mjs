#!/usr/bin/env node
// Opt-in two-profile evidence producer. Mirrors the candidate workflow's arm64
// filesystem and native SQLite probes; it does not enable promotion.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [image, ...args] = process.argv.slice(2);
const names = new Set(['--profile', '--source-sha', '--run-id', '--candidate-digest', '--qualification-out']);
const flags = {};
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  if (!names.has(name) || Object.hasOwn(flags, name) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Invalid arm64 qualification arguments.');
  flags[name] = args[index + 1];
}
const profile = flags['--profile'];
const sourceSha = flags['--source-sha'];
const runId = flags['--run-id'];
const digest = flags['--candidate-digest'];
const output = flags['--qualification-out'];
const suffix = profile === 'basic-sqlite-fs' ? '' : profile === 'clerk-sqlite-s3' ? 'clerk-s3-' : null;
const candidate = suffix !== null && /^[0-9a-f]{40}$/.test(sourceSha ?? '') && /^sha256:[0-9a-f]{64}$/.test(digest ?? '')
  ? new RegExp(`^ghcr\\.io/saluana/or3-chat:candidate-${suffix}\\d+\\.\\d+\\.\\d+-${sourceSha}@${digest}$`) : null;
if (!candidate?.test(image ?? '') || !/^\d+$/.test(runId ?? '') || !output) throw new Error('Arm64 qualification requires a pinned candidate with matching profile, source, digest and run.');

function docker(args) {
  const name = `or3-arm-qualification-${randomUUID()}`;
  const result = spawnSync('docker', [args[0], '--name', name, ...args.slice(1)], { encoding: 'utf8', timeout: 300_000, killSignal: 'SIGKILL' });
  if (result.error || result.status !== 0) {
    const cleanup = spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
    throw new Error(`Arm64 runtime probe failed: ${result.error?.message ?? result.stderr ?? ''}${cleanup.error || cleanup.status !== 0 ? `; container cleanup was not confirmed for ${name}` : ''}`);
  }
}

docker(['run', '--rm', '--platform', 'linux/arm64', '--user', '65532:65532', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--volume', '/data', '--entrypoint', '/bin/sh', image, '-c', 'printf runtime-contract > /data/probe && tar czf /tmp/data.tgz -C /data . && find /data -mindepth 1 -delete && tar xzf /tmp/data.tgz -C /data && test -f /data/probe']);
docker(['run', '--rm', '--platform', 'linux/arm64', '--entrypoint', '/nodejs/bin/node', image, '-e', 'if(process.version!=="v24.22.1"||process.arch!=="arm64")throw Error("Unexpected Node runtime: "+process.version+" "+process.arch); const D=require("/app/.output/server/node_modules/better-sqlite3"); const d=new D(":memory:"); if(d.prepare("select 42 value").get().value!==42)process.exit(1); d.close()']);
await writeFile(resolve(output), `${JSON.stringify({ schemaVersion: 1, profile, check: 'nativeAddonArm64', result: 'passed', sourceSha, workflowRunId: runId, candidateDigest: digest }, null, 2)}\n`, { flag: 'wx' });
console.log(`Wrote arm64 runtime qualification to ${output}`);
