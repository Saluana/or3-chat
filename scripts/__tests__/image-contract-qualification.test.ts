import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// No result may pass if either image has a wrong digest or missing architecture,
// an anonymous pull, runtime or operator package probe fails, identity drifts,
// or a previous result already occupies the destination.
describe('image contract qualification', () => {
  const script = resolve(import.meta.dirname, '../release/verify-image-contract.mjs');
  const source = 'a'.repeat(40);
  const digest = `sha256:${'b'.repeat(64)}`;
  const operatorDigest = `sha256:${'c'.repeat(64)}`;
  const image = `ghcr.io/saluana/or3-chat:candidate-0.1.107-${source}@${digest}`;
  const operator = `ghcr.io/saluana/or3-chat:candidate-operator-0.1.107-${source}@${operatorDigest}`;

  async function run(options: { failure?: string; image?: string; operator?: string; stale?: boolean } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'or3-image-contract-'));
    try {
      const docker = join(dir, 'docker');
      const npm = join(dir, 'npm');
      const output = join(dir, 'result.json');
      const trace = join(dir, 'trace');
      await writeFile(docker, `#!/usr/bin/env node\nconst fs=require('node:fs'), a=process.argv.slice(2), j=a.join(' '), op=j.includes('candidate-operator-');fs.appendFileSync(process.env.TRACE,JSON.stringify(a)+'\\n');const fail=process.env.FAIL;if(j.includes('imagetools inspect')){if(fail===(op?'inspect-operator':'inspect-app'))process.exit(1);console.log('Digest: '+(fail===(op?'digest-operator':'digest-app')?'sha256:'+'d'.repeat(64):op?'${operatorDigest}':'${digest}')+'\\nPlatform: linux/amd64\\n'+(fail===(op?'arch-operator':'arch-app')?'':'Platform: linux/arm64'));}else if(a[0]==='pull'){if(fail===(op?'pull-operator':'pull-app'))process.exit(1);}else if(a[0]==='run'){if(a.includes('--version')){if(fail===(op?'node-operator':'node-app'))process.exit(1);console.log(fail===(op?'wrong-node-operator':'wrong-node-app')?'v0.0.0':process.env.NODE_VERSION);}else if(fail==='operator-install')process.exit(1);}else process.exit(1);\n`);
      await writeFile(npm, `#!/usr/bin/env node\nif(process.env.FAIL==='npm')process.exit(1);console.log('0.1.94');\n`);
      await Promise.all([docker, npm].map((path) => chmod(path, 0o755)));
      if (options.stale) await writeFile(output, 'stale');
      const result = spawnSync('node', [script, options.image ?? image, '--operator', options.operator ?? operator, '--profile', 'basic-sqlite-fs', '--source-sha', source, '--run-id', '123', '--candidate-digest', digest, '--operator-digest', operatorDigest, '--qualification-out', output], { cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TRACE: trace, FAIL: options.failure ?? '', NODE_VERSION: process.version }, encoding: 'utf8', timeout: 20_000 });
      return { status: result.status, stderr: result.stderr, output: existsSync(output) ? await readFile(output, 'utf8') : null, trace: existsSync(trace) ? (await readFile(trace, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)) : [] };
    } finally { await rm(dir, { recursive: true, force: true }); }
  }

  it('certifies only after both immutable images pass all existing probes', async () => {
    const result = await run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.output!)).toEqual({ schemaVersion: 1, profile: 'basic-sqlite-fs', check: 'imageContract', result: 'passed', sourceSha: source, workflowRunId: '123', candidateDigest: digest, operatorCandidateDigest: operatorDigest });
    expect(result.trace).toHaveLength(7);
    expect(result.trace.filter((call: string[]) => call[0] === 'pull').map((call: string[]) => call.at(-1))).toEqual([image, operator]);
    expect(result.trace.at(-1)).toContain(operator);
    expect(result.trace.at(-1).join(' ')).toContain('npm-cli.js');
  });

  it.each(['inspect-app', 'inspect-operator', 'digest-app', 'digest-operator', 'arch-app', 'arch-operator', 'pull-app', 'pull-operator', 'node-app', 'node-operator', 'wrong-node-app', 'wrong-node-operator', 'npm', 'operator-install'])('does not certify a failed %s check', async (failure) => {
    const result = await run({ failure });
    expect(result.status).not.toBe(0);
    expect(result.output).toBeNull();
  });

  it('rejects a mutable or mismatched image before contacting Docker', async () => {
    for (const options of [{ image: image.replace(`@${digest}`, '') }, { operator: operator.replace(source, 'e'.repeat(40)) }]) {
      const result = await run(options);
      expect(result.status).not.toBe(0);
      expect(result.trace).toEqual([]);
      expect(result.output).toBeNull();
    }
  });

  it('does not overwrite an existing result', async () => {
    const result = await run({ stale: true });
    expect(result.status).not.toBe(0);
    expect(result.output).toBe('stale');
  });
});
