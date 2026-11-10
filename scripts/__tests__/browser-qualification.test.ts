import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Failures: wrong profile, package, image or operator; wrong proxy/network;
// either browser journey failing; image replacement during the journey; or a
// stale result must not produce a passing browser qualification.
describe('default browser qualification', () => {
  const verifier = resolve(import.meta.dirname, '../release/verify-browser-qualification.mjs');
  const source = 'a'.repeat(40);
  const appDigest = `sha256:${'b'.repeat(64)}`;
  const operatorDigest = `sha256:${'c'.repeat(64)}`;
  const repo = 'ghcr.io/saluana/or3-chat';
  const app = `${repo}:candidate-0.1.107-${source}@${appDigest}`;
  const operator = `${repo}:candidate-operator-0.1.107-${source}@${operatorDigest}`;

  async function run(options: { failure?: string; profile?: string; stale?: boolean } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'or3-browser-qualification-'));
    try {
      const deploy = join(dir, 'or3-cloud-candidate'); const scripts = join(dir, 'scripts');
      await mkdir(join(deploy, '.or3-cloud'), { recursive: true });
      await mkdir(join(dir, 'package/assets'), { recursive: true }); await mkdir(scripts);
      await copyFile(verifier, join(scripts, 'verify-browser-qualification.mjs'));
      await copyFile(resolve(import.meta.dirname, '../release/browser-process.mjs'), join(scripts, 'browser-process.mjs'));
      await writeFile(join(deploy, '.env'), 'fixture=1\n');
      await writeFile(join(deploy, '.or3-cloud/state.json'), JSON.stringify({ schemaVersion: 1, mode: 'local', appVersion: '0.1.107', imageDigest: appDigest, image: options.failure === 'candidate-ref' ? app : `${repo}@${appDigest}`, deploymentId: 'd'.repeat(32), composeProject: 'fixture', port: 3017 }));
      await writeFile(join(dir, 'package/package.json'), JSON.stringify({ name: '@or3/cloud', version: '0.1.107', or3Cloud: { imageDigest: appDigest, operatorImageDigest: operatorDigest, sourceRevision: options.failure === 'package' ? '0'.repeat(40) : source } }));
      const proxyImage = `caddy:2.10.2@sha256:${'f'.repeat(64)}`;
      const caddyfile = join(dir, 'Caddyfile');
      await writeFile(join(dir, 'package/assets/compose.public.yaml'), `services:\n  caddy:\n    image: ${proxyImage}\n`);
      await writeFile(join(dir, 'package/assets/Caddyfile'), 'proxy fixture\n');
      await writeFile(caddyfile, options.failure === 'caddyfile' ? 'modified\n' : 'proxy fixture\n');
      const tarball = join(dir, 'cloud.tgz');
      expect(spawnSync('/usr/bin/tar', ['-czf', tarball, '-C', dir, 'package']).status).toBe(0);
      const sha = createHash('sha256').update(await readFile(tarball)).digest('hex');
      const docker = join(dir, 'docker'); const trace = join(dir, 'trace'); const calls = join(dir, 'calls');
      await writeFile(join(scripts, 'smoke-browser.mjs'), `import {appendFileSync} from 'node:fs'; appendFileSync(process.env.TRACE,JSON.stringify({cwd:process.cwd(),url:process.env.OR3_SMOKE_URL,hydration:process.env.OR3_SMOKE_HYDRATION_ONLY,artifacts:process.env.OR3_SMOKE_ARTIFACT_DIR,securityOrigin:process.env.OR3_SMOKE_SECURITY_ORIGIN})+'\\n'); if(process.env.FAIL===(process.env.OR3_SMOKE_HYDRATION_ONLY==='1'?'proxy-browser':'full-browser')) process.exit(1);`);
      await writeFile(docker, `#!/usr/bin/env node\nconst fs=require('node:fs'),a=process.argv.slice(2),f=process.env.FAIL,repo='${repo}',proxyImage='${proxyImage}';if(a[0]==='compose'){console.log(a.at(-1)==='or3'?'app-container':'operator-container')}else if(a[0]==='inspect'){const n=a.at(-1),op=n==='operator-container',proxy=n==='or3-candidate-caddy';let count=Number(fs.existsSync(process.env.CALLS)?fs.readFileSync(process.env.CALLS,'utf8'):0);if(n==='app-container'){count++;fs.writeFileSync(process.env.CALLS,String(count));}let digest=op?'${operatorDigest}':'${appDigest}';if(f===(op?'operator':'app')||f==='drift'&&n==='app-container'&&count>1)digest='sha256:'+'e'.repeat(64);const port=proxy?'3018':'3017', imageId=proxy?'proxy-id':op?'operator-id':'app-id',env=['AUTH_PROVIDER=basic-auth','SSR_AUTH_ENABLED=true','OR3_SYNC_ENABLED=true','OR3_SYNC_PROVIDER=sqlite','OR3_STORAGE_ENABLED=true','NUXT_PUBLIC_STORAGE_PROVIDER=fs'];if(f==='provider')env.push('NUXT_AUTH_PROVIDER=clerk');if(f==='missing-provider')env.splice(0,1);console.log(JSON.stringify({Id:n,Image:f==='image-id'&&!proxy&&!op?'wrong':imageId,State:{Running:true},Config:{Env:env,Image:proxy?(f==='proxy-image'?'wrong':proxyImage):repo+'@'+digest,Labels:{'io.or3.cloud.deployment-id':'${'d'.repeat(32)}','com.docker.compose.project':'fixture'}},Mounts:proxy?[{Destination:'/etc/caddy/Caddyfile',Source:process.env.CADDYFILE,RW:false}]:[],NetworkSettings:{Networks:{default:{NetworkID:f==='network'&&proxy?'wrong':'network'}},Ports:{[proxy?'3018/tcp':'3000/tcp']:[{HostIp:'127.0.0.1',HostPort:f==='port'?'9999':port}]}}}));}else if(a[0]==='image'){const ref=a.at(-1),id=ref===proxyImage?'proxy-id':ref.includes('candidate-operator')?'operator-id':'app-id';console.log(JSON.stringify({Id:id,Config:{Labels:{'org.opencontainers.image.revision':f==='labels'?'wrong':'${source}','org.opencontainers.image.version':'0.1.107'}}}))}else if(a[0]==='exec'){if(!a.at(-1).includes('AbortSignal.timeout'))process.exit(1);const count=Number(fs.readFileSync(process.env.CALLS,'utf8'));console.log(JSON.stringify({status:'ok',providers:{auth:{provider:f==='health'||f==='health-drift'&&count>1?'clerk':'basic-auth'},sync:{provider:'sqlite'},storage:{provider:'fs'}}}));}else process.exit(1);\n`);
      await chmod(docker, 0o755);
      const output = join(dir, 'browser.json');
      if (options.stale) await writeFile(output, 'stale');
      const result = spawnSync('node', [join(scripts, 'verify-browser-qualification.mjs'), '--deployment', deploy, '--image', app, '--operator', operator, '--profile', options.profile ?? 'basic-sqlite-fs', '--source-sha', source, '--run-id', '123', '--candidate-digest', appDigest, '--operator-digest', operatorDigest, '--tarball', tarball, '--qualification-out', output], { cwd: dir, env: { ...process.env, GITHUB_ACTIONS: options.failure === 'not-runner' ? 'false' : 'true', RUNNER_TEMP: options.failure === 'wrong-runner-path' ? join(dir, 'other') : dir, PATH: `${dir}:${process.env.PATH}`, TRACE: trace, CALLS: calls, CADDYFILE: caddyfile, OR3_SMOKE_CADDYFILE: caddyfile, OR3_SMOKE_ARTIFACT_DIR: join(dir, 'artifacts'), FAIL: options.failure ?? '' }, encoding: 'utf8', timeout: 20_000 });
      return { status: result.status, stderr: result.stderr, output: existsSync(output) ? await readFile(output, 'utf8') : null, trace: existsSync(trace) ? (await readFile(trace, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)) : [], sha, deploy: await realpath(deploy), dir };
    } finally { await rm(dir, { recursive: true, force: true }); }
  }

  it('binds both journeys and the observed deployment to the packed CLI', async () => {
    const result = await run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.output!)).toEqual({ schemaVersion: 1, profile: 'basic-sqlite-fs', check: 'browser', result: 'passed', sourceSha: source, workflowRunId: '123', candidateDigest: appDigest, operatorCandidateDigest: operatorDigest, tarballSha256: result.sha });
    expect(result.trace).toEqual([
      { cwd: result.deploy, url: 'https://localhost:3018', hydration: '1', artifacts: join(result.dir, 'artifacts/proxy') },
      { cwd: result.deploy, url: 'http://127.0.0.1:3017', artifacts: join(result.dir, 'artifacts/full'), securityOrigin: 'https://localhost:3018' },
    ]);
  });

  it('accepts the exact candidate tag plus digest used by the workflow', async () => {
    const result = await run({ failure: 'candidate-ref' });
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(['not-runner', 'wrong-runner-path', 'package', 'app', 'operator', 'network', 'port', 'labels', 'provider', 'missing-provider', 'health', 'health-drift', 'image-id', 'proxy-image', 'caddyfile', 'proxy-browser', 'full-browser', 'drift'])('does not certify %s failure', async (failure) => {
    const result = await run({ failure });
    expect(result.status).not.toBe(0);
    expect(result.output).toBeNull();
  });

  it('refuses the unfinished Clerk browser path and stale output', async () => {
    const wrong = await run({ profile: 'clerk-sqlite-s3' });
    expect(wrong.status).not.toBe(0); expect(wrong.trace).toEqual([]); expect(wrong.output).toBeNull();
    const stale = await run({ stale: true });
    expect(stale.status).not.toBe(0); expect(stale.output).toBe('stale');
  });
});
