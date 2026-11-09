import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The workflow owns sequence completion; these tests cover identity drift,
// tampered inputs, and refusal to certify a missing or unhealthy deployment.
describe('lifecycle evidence boundaries', () => {
  it('binds the baseline and candidate, and refuses changed evidence or identities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'or3-lifecycle-evidence-'));
    try {
      const deploy = join(root, 'or3-cloud-candidate');
      await mkdir(deploy);
      await mkdir(join(root, 'package'));
      const source = 'a'.repeat(40), digest = `sha256:${'b'.repeat(64)}`, operatorDigest = `sha256:${'c'.repeat(64)}`;
      const repo = 'ghcr.io/saluana/or3-chat';
      const image = `${repo}:candidate-0.1.107-${source}@${digest}`;
      const operator = `${repo}:candidate-operator-0.1.107-${source}@${operatorDigest}`;
      const tarball = join(root, 'cloud.tgz'), inputs = join(root, 'inputs.json'), baseline = join(root, 'baseline.json');
      await writeFile(join(root, 'package/package.json'), JSON.stringify({ name: '@or3/cloud', version: '0.1.107', or3Cloud: { sourceRevision: source, imageDigest: digest, operatorImageDigest: operatorDigest } }));
      expect(spawnSync('tar', ['-czf', tarball, '-C', root, 'package']).status).toBe(0);
      const tarballSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
      const browser = join(root, 'browser.json');
      await writeFile(browser, JSON.stringify({ schemaVersion: 1, profile: 'basic-sqlite-fs', check: 'browser', result: 'passed', sourceSha: source, workflowRunId: '123', candidateDigest: digest, operatorCandidateDigest: operatorDigest, tarballSha256 }));
      const state = (version: string, imageDigest: string, pending = false) => ({ schemaVersion: 1, mode: 'local', appVersion: version, imageDigest, image: `${repo}@${imageDigest}`, port: 3017, deploymentId: 'd'.repeat(32), composeProject: 'fixture', ...(pending ? { incompleteOperation: { operation: 'update' } } : {}) });
      const statePath = join(deploy, '.or3-cloud/state.json');
      const oldDigest = `sha256:${'e'.repeat(64)}`;
      const docker = join(root, 'docker');
      await writeFile(docker, `#!/usr/bin/env node\nconst a=process.argv.slice(2),p=process.env.PHASE,app=p==='baseline'?'${repo}@${oldDigest}':'${repo}@${digest}',operator=process.env.BAD_OPERATOR?'${repo}:latest':p==='baseline'?'${repo}@sha256:'+'f'.repeat(64):'${repo}@${operatorDigest}';if(a[0]==='compose')console.log(a.at(-1)==='or3'?'app':'operator');else if(a[0]==='inspect'){const op=a.at(-1)==='operator';console.log(JSON.stringify({Id:op?'operator':'app',Image:process.env.BAD_IMAGE_ID?'wrong':(op?'operator-':'app-')+p,State:{Running:true},Config:{Image:op?operator:app,Labels:{'io.or3.cloud.deployment-id':'${'d'.repeat(32)}','com.docker.compose.project':'fixture'}}}));}else if(a[0]==='image')console.log(JSON.stringify({Id:(a.at(-1).includes('operator')||a.at(-1).endsWith('f'.repeat(64)))?'operator-'+p:'app-'+p,Config:{Labels:{'org.opencontainers.image.revision':process.env.BAD_LABEL?'wrong':'${source}','org.opencontainers.image.version':'0.1.107'}}}));else if(a[0]==='exec')console.log(JSON.stringify({status:'ok',providers:{auth:{provider:'basic-auth'},sync:{provider:'sqlite'},storage:{provider:process.env.BAD_HEALTH?'s3':'fs'}}}));else process.exit(1);\n`);
      await chmod(docker, 0o755);
      const script = resolve(import.meta.dirname, '../release/lifecycle-evidence.mjs');
      const args = ['--deployment', deploy, '--image', image, '--operator', operator, '--source-sha', source, '--run-id', '123', '--previous-version', '0.1.106', '--candidate-digest', digest, '--operator-digest', operatorDigest, '--tarball', tarball, '--inputs', inputs, '--baseline', baseline, '--browser', browser, '--qualification-out', join(root, 'lifecycle.json')];
      const run = (action: string, phase: string, extra: Record<string, string> = {}) => spawnSync('node', [script, action, ...args], { env: { ...process.env, GITHUB_ACTIONS: 'true', RUNNER_TEMP: root, PATH: `${root}:${process.env.PATH}`, PHASE: phase, ...extra }, encoding: 'utf8', timeout: 10_000 });
      expect(run('begin', 'baseline').status).toBe(0);
      await mkdir(join(deploy, '.or3-cloud'));
      await writeFile(join(deploy, '.env'), 'FIXTURE=1\n');
      await writeFile(statePath, JSON.stringify(state('0.1.107', oldDigest)));
      expect(run('baseline', 'baseline').stderr).toContain('baseline image mismatch');
      await writeFile(statePath, JSON.stringify(state('0.1.106', oldDigest)));
      expect(run('baseline', 'baseline', { BAD_OPERATOR: '1' }).stderr).toContain('baseline image mismatch');
      expect(run('baseline', 'baseline', { BAD_IMAGE_ID: '1' }).stderr).toContain('baseline image ID mismatch');
      const captured = run('baseline', 'baseline');
      expect(captured.status, captured.stderr).toBe(0);
      expect(run('assert-baseline', 'baseline').status).toBe(0);
      await writeFile(statePath, JSON.stringify({ ...state('0.1.106', oldDigest), schemaVersion: 2 }));
      expect(run('assert-baseline', 'baseline').status).toBe(0);
      expect(run('assert-baseline', 'candidate').status).not.toBe(0);
      await writeFile(statePath, JSON.stringify(state('0.1.107', digest, true)));
      expect(run('finish', 'candidate').status).not.toBe(0);
      await writeFile(statePath, JSON.stringify(state('0.1.107', digest)));
      expect(run('finish', 'candidate', { BAD_HEALTH: '1' }).status).not.toBe(0);
      expect(run('finish', 'candidate', { BAD_IMAGE_ID: '1' }).stderr).toContain('final image labels mismatch');
      expect(run('finish', 'candidate', { BAD_LABEL: '1' }).stderr).toContain('final image labels mismatch');
      await writeFile(browser, '{}');
      expect(run('finish', 'candidate').stderr).toContain('browser evidence mismatch');
      expect(existsSync(join(root, 'lifecycle.json'))).toBe(false);
      await writeFile(browser, JSON.stringify({ schemaVersion: 1, profile: 'basic-sqlite-fs', check: 'browser', result: 'passed', sourceSha: source, workflowRunId: '123', candidateDigest: digest, operatorCandidateDigest: operatorDigest, tarballSha256 }));
      const result = run('finish', 'candidate');
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(await readFile(join(root, 'lifecycle.json'), 'utf8'))).toEqual({ schemaVersion: 1, profile: 'basic-sqlite-fs', check: 'lifecycle', result: 'passed', sourceSha: source, workflowRunId: '123', candidateDigest: digest, operatorCandidateDigest: operatorDigest, tarballSha256 });
      expect(run('finish', 'candidate').status).not.toBe(0);
      await writeFile(tarball, 'tampered');
      expect(run('assert-baseline', 'baseline').status).not.toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
