import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

// The artifact must never certify a mutable/wrong image, a failed filesystem
// probe, a failed native SQLite probe, or reuse an existing result file.
describe('arm64 runtime qualification', () => {
  const script = resolve(import.meta.dirname, '../release/verify-arm-runtime.mjs');
  const source = 'a'.repeat(40);
  const digest = `sha256:${'b'.repeat(64)}`;
  const image = `ghcr.io/saluana/or3-chat:candidate-0.1.107-${source}@${digest}`;

  async function run(options: { failure?: string; image?: string; profile?: string; stale?: boolean } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'or3-arm-qualification-'));
    try {
      const docker = join(dir, 'docker');
      const output = join(dir, 'result.json');
      const trace = join(dir, 'trace');
      await writeFile(docker, `#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync(process.env.TRACE,JSON.stringify(process.argv.slice(2))+'\\n');if(process.env.FAIL==='filesystem'&&process.argv.includes('/bin/sh')||process.env.FAIL==='native'&&process.argv.includes('/nodejs/bin/node'))process.exit(1);\n`);
      await chmod(docker, 0o755);
      if (options.stale) await writeFile(output, 'stale');
      const result = spawnSync('node', [script, options.image ?? image, '--profile', options.profile ?? 'basic-sqlite-fs', '--source-sha', source, '--run-id', '123', '--candidate-digest', digest, '--qualification-out', output], { cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TRACE: trace, FAIL: options.failure ?? '' }, encoding: 'utf8', timeout: 20_000 });
      return { status: result.status, stderr: result.stderr, output: existsSync(output) ? await readFile(output, 'utf8') : null, trace: existsSync(trace) ? (await readFile(trace, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)) : [] };
    } finally { await rm(dir, { recursive: true, force: true }); }
  }

  it('writes a bound result after both exact-image arm64 probes pass', async () => {
    const result = await run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.output!)).toEqual({ schemaVersion: 1, profile: 'basic-sqlite-fs', check: 'nativeAddonArm64', result: 'passed', sourceSha: source, workflowRunId: '123', candidateDigest: digest });
    expect(result.trace).toHaveLength(2);
    for (const call of result.trace) {
      expect(call).toContain(image);
      expect(call.slice(call.indexOf('--platform'), call.indexOf('--platform') + 2)).toEqual(['--platform', 'linux/arm64']);
    }
    expect(result.trace[0]).toContain('/bin/sh');
    expect(result.trace[1]).toContain('/nodejs/bin/node');
    expect(result.trace[1].at(-1)).toContain('process.arch');
    const probe = result.trace[1].at(-1);
    class FakeDatabase { prepare() { return { get: () => ({ value: 42 }) }; } close() {} }
    const context = (arch: string) => ({ process: { version: 'v24.22.1', arch, exit: () => { throw new Error('probe failed'); } }, require: () => FakeDatabase });
    expect(() => runInNewContext(probe, context('arm64'))).not.toThrow();
    expect(() => runInNewContext(probe, context('x64'))).toThrow(/Unexpected Node runtime/);
  });

  it.each(['filesystem', 'native'])('does not certify a failed %s probe', async (failure) => {
    const result = await run({ failure });
    expect(result.status).not.toBe(0);
    expect(result.output).toBeNull();
    const failedRun = result.trace.find((call: string[]) => call.includes(failure === 'filesystem' ? '/bin/sh' : '/nodejs/bin/node'));
    const name = failedRun[failedRun.indexOf('--name') + 1];
    expect(name).toMatch(/^or3-arm-qualification-/);
    expect(result.trace.at(-1)).toEqual(['rm', '-f', name]);
  });

  it('refuses a mutable image and a profile mismatch before Docker', async () => {
    for (const options of [{ image: image.replace(`@${digest}`, '') }, { profile: 'clerk-sqlite-s3' }]) {
      const result = await run(options);
      expect(result.status).not.toBe(0);
      expect(result.trace).toEqual([]);
      expect(result.output).toBeNull();
    }
  });

  it('does not overwrite an existing qualification', async () => {
    const result = await run({ stale: true });
    expect(result.status).not.toBe(0);
    expect(result.output).toBe('stale');
  });
});
