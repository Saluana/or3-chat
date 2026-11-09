import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Failures: mutable/wrong image, profile/source/digest mismatch, unsupported
// architecture, absent provenance, failed scanner, high vulnerability, and a
// stale output file must never produce a new passing qualification artifact.
describe('digest-bound image scan qualification', () => {
  const root = resolve(import.meta.dirname, '../..');
  const source = 'a'.repeat(40);
  const digest = `sha256:${'b'.repeat(64)}`;
  const image = `ghcr.io/saluana/or3-chat:candidate-0.1.107-${source}@${digest}`;

  async function run(options: { args?: string[]; failure?: string; stale?: boolean } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'or3-scan-qualification-'));
    try {
      const bin = join(dir, 'docker');
      const syft = join(dir, 'syft');
      const trivy = join(dir, 'trivy');
      await writeFile(bin, `#!/usr/bin/env node\nconst p={SLSA:{buildType:'https://mobyproject.org/buildkit@v1'}};if (process.env.SCAN_FAILURE === 'digest') console.log('Digest: sha256:'+'c'.repeat(64)); else if (process.argv.includes('--format')) console.log(process.env.SCAN_FAILURE === 'provenance' ? 'null' : process.env.SCAN_FAILURE === 'empty-provenance' ? '{}' : JSON.stringify(process.env.SCAN_FAILURE === 'wrong-provenance-platform'?{'linux/arm64':p}:{'linux/amd64':p,'linux/arm64':p})); else console.log('Digest: ${digest}');\n`);
      await writeFile(syft, `#!/usr/bin/env node\nif(process.env.SCAN_FAILURE==='syft'||!process.argv.includes(process.env.EXPECT_IMAGE)||process.argv[process.argv.indexOf('--platform')+1]!==process.env.EXPECT_PLATFORM)process.exit(1); console.log(process.env.SCAN_FAILURE==='bad-sbom' ? '{}' : JSON.stringify({spdxVersion:'SPDX-2.3',packages:[{name:'fixture'}]}));\n`);
      await writeFile(trivy, `#!/usr/bin/env node\nconst v={Severity:'HIGH',VulnerabilityID:'fixture',PkgName:'fixture',InstalledVersion:'1'};if(process.env.SCAN_FAILURE==='missing-severity')delete v.Severity;if(process.argv.includes('--version'))console.log('Version: 1.0');else if(process.env.SCAN_FAILURE==='trivy'||!process.argv.includes(process.env.EXPECT_IMAGE)||process.argv[process.argv.indexOf('--platform')+1]!==process.env.EXPECT_PLATFORM)process.exit(1);else console.log(process.env.SCAN_FAILURE==='bad-report' ? '{}' : JSON.stringify({SchemaVersion:2,Results:[{Target:'fixture',Vulnerabilities:['high','missing-severity'].includes(process.env.SCAN_FAILURE)?[v]:[]}]}));\n`);
      await Promise.all([bin, syft, trivy].map((p) => chmod(p, 0o755)));
      const out = join(dir, 'qualification.json');
      if (options.stale) await writeFile(out, 'stale');
      const args = options.args ?? [image, '--platform', 'linux/amd64', '--profile', 'basic-sqlite-fs', '--source-sha', source, '--run-id', '123', '--candidate-digest', digest];
      const result = spawnSync('node', [join(root, 'scripts/release/scan-image.mjs'), ...args, '--syft', syft, '--trivy', trivy, '--qualification-out', out], { cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SCAN_FAILURE: options.failure ?? '', EXPECT_IMAGE: args[0], EXPECT_PLATFORM: args[args.indexOf('--platform') + 1] }, encoding: 'utf8', timeout: 20_000 });
      return { status: result.status, stderr: result.stderr, output: existsSync(out) ? await readFile(out, 'utf8') : null };
    } finally { await rm(dir, { recursive: true, force: true }); }
  }

  it('writes the receipt-compatible result only after a passing pinned scan', async () => {
    const result = await run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.output!)).toEqual({ schemaVersion: 1, profile: 'basic-sqlite-fs', check: 'scanAmd64', result: 'passed', sourceSha: source, workflowRunId: '123', candidateDigest: digest });
  });

  it('binds an arm64 scan to the launch profile', async () => {
    const launch = image.replace('candidate-', 'candidate-clerk-s3-');
    const result = await run({ args: [launch, '--platform', 'linux/arm64', '--profile', 'clerk-sqlite-s3', '--source-sha', source, '--run-id', '123', '--candidate-digest', digest] });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.output!)).toEqual({ schemaVersion: 1, profile: 'clerk-sqlite-s3', check: 'scanArm64', result: 'passed', sourceSha: source, workflowRunId: '123', candidateDigest: digest });
  });

  it.each(['digest', 'provenance', 'empty-provenance', 'wrong-provenance-platform', 'syft', 'bad-sbom', 'trivy', 'bad-report', 'missing-severity', 'high'])('does not certify a failed %s scan', async (failure) => {
    const result = await run({ failure });
    expect(result.status).not.toBe(0);
    expect(result.output).toBeNull();
  });

  it.each([
    [image.replace(`@${digest}`, ''), 'linux/amd64', 'basic-sqlite-fs', source, digest],
    [image, 'linux/amd64', 'clerk-sqlite-s3', source, digest],
    [image, 'linux/amd64', 'basic-sqlite-fs', 'c'.repeat(40), digest],
    [image, 'linux/amd64', 'basic-sqlite-fs', source, `sha256:${'c'.repeat(64)}`],
    [image, 'linux/386', 'basic-sqlite-fs', source, digest],
  ])('rejects mismatched image or scan identity', async (candidate, platform, profile, sha, expectedDigest) => {
    const result = await run({ args: [candidate, '--platform', platform, '--profile', profile, '--source-sha', sha, '--run-id', '123', '--candidate-digest', expectedDigest] });
    expect(result.status).not.toBe(0);
    expect(result.output).toBeNull();
  });

  it('refuses to overwrite a stale qualification artifact', async () => {
    const result = await run({ stale: true });
    expect(result.status).not.toBe(0);
    expect(result.output).toBe('stale');
  });
});
