import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ASSET_ROOT = resolve(import.meta.dir, '../assets');
const RUNTIME_ENTRYPOINT = resolve(import.meta.dir, '../../../scripts/docker/runtime-entrypoint.mjs');
const DOCKERFILE = resolve(import.meta.dir, '../../../Dockerfile');
const CLOUD_CLI_SOURCE = resolve(import.meta.dir, '../src/cli.ts');
const RELEASE_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/release-cloud.yml');

function asset(name: string): string {
  return readFileSync(resolve(ASSET_ROOT, name), 'utf8');
}

test('Caddyfile sets the full security header set inside the site block', () => {
  const caddyfile = asset('Caddyfile');
  const siteBlock = caddyfile.slice(caddyfile.indexOf('{'), caddyfile.lastIndexOf('}'));
  expect(siteBlock).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"');
  expect(siteBlock).toContain('X-Content-Type-Options "nosniff"');
  expect(siteBlock).toContain('X-Frame-Options "DENY"');
  expect(siteBlock).toContain('Referrer-Policy "strict-origin-when-cross-origin"');
  expect(siteBlock).toContain('Permissions-Policy "camera=(), microphone=(), geolocation=()"');
});

test('Caddyfile keeps SSE streaming and compression intact', () => {
  const caddyfile = asset('Caddyfile');
  expect(caddyfile).toContain('flush_interval -1');
  expect(caddyfile).toContain('encode zstd gzip');
  expect(caddyfile).toContain('reverse_proxy or3:3000');
});

test('local compose.yaml has no Caddy service', () => {
  const compose = asset('compose.yaml');
  expect(compose).not.toMatch(/^\s*caddy:/m);
});

test('Dockerfile builds shared Nuxt output only once on the native runner', () => {
  const dockerfile = readFileSync(DOCKERFILE, 'utf8');
  expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM node:.* AS build$/m);
  expect(dockerfile).toMatch(/^FROM busybox:1\.37\.0-uclibc@sha256:.* AS runtime-tools$/m);
  expect(dockerfile).toMatch(/^FROM gcr\.io\/distroless\/nodejs24-debian13:.* AS runtime$/m);
  const toolsStage = dockerfile.slice(dockerfile.indexOf('FROM busybox:'), dockerfile.indexOf(' AS build'));
  expect(toolsStage).not.toContain('\nRUN ');
  expect(dockerfile).toContain('COPY --from=runtime-tools /bin/ /bin/');
  expect(dockerfile).toContain('ENTRYPOINT ["/nodejs/bin/node"');
});

test('compose.yaml deep health treats degraded as unhealthy', () => {
  const compose = asset('compose.yaml');
  const healthcheck = compose.slice(compose.indexOf('healthcheck:'));
  expect(healthcheck).toContain('deep=true');
  expect(healthcheck).toContain('/nodejs/bin/node');
  expect(healthcheck).toContain("b.status!=='ok'");
  expect(healthcheck).toContain('process.exit(1)');
  expect(healthcheck).toContain('interval: 10s');
  expect(healthcheck).toContain('timeout: 5s');
  expect(healthcheck).toContain('retries: 12');
  expect(healthcheck).toContain('start_period: 30s');
});

test('container-side CLI probes use the runtime Node executable explicitly', () => {
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  expect(cli).toContain("const CONTAINER_NODE = '/nodejs/bin/node';");
  expect(cli).not.toContain("'or3', 'node', '-e'");
});

test('restore and adoption stream private archives into the managed volume', () => {
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  expect(cli).toContain('pipeline(createReadStream(source), child.stdin)');
  expect(cli).toContain("'find /data -mindepth 1 -delete && tar xzf - -C /data'");
  expect(cli).not.toContain('`${backupPath}:/backup:ro`');
  expect(cli).not.toContain("'--user', '0:0', '-v', `${sourceVolume}:/source:ro`");
});

test('compose failures capture redacted state before cleanup', () => {
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  expect(cli).toContain("['compose ps', ['ps', '-a']]");
  expect(cli).toContain("['compose logs', ['logs', '--tail=200']]");
  expect(cli).toContain("['inspect', '--format', '{{json .State}}', container]");
  expect(cli.match(/Captured Docker diagnostics:/g)?.length).toBe(2);
});

test('release smoke re-resolves amd64 after architecture-specific scans', () => {
  const workflow = readFileSync(RELEASE_WORKFLOW, 'utf8');
  const smoke = workflow.slice(
    workflow.indexOf('- name: Smoke-test the qualifying image on amd64'),
    workflow.indexOf('# Clean-browser journey'),
  );
  const pull = smoke.indexOf('docker pull --platform linux/amd64 "$OR3_IMAGE"');
  const init = smoke.indexOf('or3 init "$smoke"');
  expect(pull).toBeGreaterThan(-1);
  expect(init).toBeGreaterThan(pull);
});

test('compose.yaml hardens the or3 container', () => {
  const compose = asset('compose.yaml');
  expect(compose).toContain('no-new-privileges:true');
  expect(compose).toContain('cap_drop:');
  expect(compose).toContain('- ALL');
  expect(compose).toContain('read_only: true');
  expect(compose).toContain('/tmp:size=256m');
  expect(compose).toContain('max-size: "10m"');
  expect(compose).toContain('max-file: "3"');
});

test('runtime entrypoint maps managed registration policy into Nuxt runtime config', () => {
  const entrypoint = readFileSync(RUNTIME_ENTRYPOINT, 'utf8');
  expect(entrypoint).toContain("const registrationMode = firstDefined(env.OR3_AUTH_REGISTRATION_MODE, 'open');");
  expect(entrypoint).toContain('NUXT_AUTH_REGISTRATION_MODE');
  expect(entrypoint).toContain("const autoProvision = firstDefined(env.OR3_AUTH_AUTO_PROVISION, 'true');");
  expect(entrypoint).toContain('NUXT_AUTH_AUTO_PROVISION');
  expect(entrypoint).toContain('const bootstrapEmail = firstDefined(env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL);');
  expect(entrypoint).toContain('NUXT_AUTH_BOOTSTRAP_EMAIL');
  expect(entrypoint).toContain('const inviteTokenSecret = firstDefined(env.OR3_AUTH_INVITE_TOKEN_SECRET);');
  expect(entrypoint).toContain('NUXT_AUTH_INVITE_TOKEN_SECRET');
});

test('runtime entrypoint preserves explicit Nuxt settings while translating OR3 defaults', () => {
  const probe = [
    'NUXT_AUTH_ENABLED',
    'NUXT_AUTH_PROVIDER',
    'NUXT_AUTH_REGISTRATION_MODE',
    'NUXT_AUTH_AUTO_PROVISION',
    'NUXT_AUTH_BOOTSTRAP_EMAIL',
    'NUXT_AUTH_INVITE_TOKEN_SECRET',
    'NUXT_SYNC_ENABLED',
    'NUXT_STORAGE_ENABLED',
    'NUXT_ADMIN_AUTH_JWT_SECRET'
  ];
  const result = spawnSync(process.execPath, [
    RUNTIME_ENTRYPOINT,
    process.execPath,
    '-e',
    `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(probe)}.map((name) => [name, process.env[name]]))))`
  ], {
    encoding: 'utf8',
    env: {
      SSR_AUTH_ENABLED: 'true',
      AUTH_PROVIDER: 'basic-auth',
      OR3_AUTH_REGISTRATION_MODE: 'invite_only',
      OR3_AUTH_AUTO_PROVISION: 'false',
      OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'admin@example.com',
      OR3_AUTH_INVITE_TOKEN_SECRET: 'invite-secret',
      OR3_CLOUD_SYNC_ENABLED: 'true',
      OR3_CLOUD_STORAGE_ENABLED: 'true',
      OR3_BASIC_AUTH_JWT_SECRET: 'basic-auth-secret',
      NUXT_AUTH_PROVIDER: 'custom'
    }
  });

  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    NUXT_AUTH_ENABLED: 'true',
    NUXT_AUTH_PROVIDER: 'custom',
    NUXT_AUTH_REGISTRATION_MODE: 'invite_only',
    NUXT_AUTH_AUTO_PROVISION: 'false',
    NUXT_AUTH_BOOTSTRAP_EMAIL: 'admin@example.com',
    NUXT_AUTH_INVITE_TOKEN_SECRET: 'invite-secret',
    NUXT_SYNC_ENABLED: 'true',
    NUXT_STORAGE_ENABLED: 'true',
    NUXT_ADMIN_AUTH_JWT_SECRET: 'c048744982bcfb2314b6718c134f2beb50a47ddec451172d8c87e6fca0d73e64'
  });
});

test('compose.public.yaml pins Caddy to an exact digest', () => {
  const compose = asset('compose.public.yaml');
  expect(compose).toMatch(/image: caddy:2\.10\.\d+-alpine@sha256:[0-9a-f]{64}/);
});

test('compose.public.yaml hardens the Caddy container', () => {
  const compose = asset('compose.public.yaml');
  expect(compose).toContain('no-new-privileges:true');
  expect(compose).toContain('cap_drop:');
  expect(compose).toContain('- ALL');
  expect(compose).toContain('cap_add:');
  expect(compose).toContain('- NET_BIND_SERVICE');
  expect(compose).toContain('read_only: true');
  expect(compose).toContain('/tmp:size=64m,noexec,nosuid');
  expect(compose).toContain('max-size: "10m"');
  expect(compose).toContain('max-file: "3"');
});

test('compose.public.yaml keeps the public proxy wiring intact', () => {
  const compose = asset('compose.public.yaml');
  expect(compose).toContain('condition: service_healthy');
  expect(compose).toContain('"80:80"');
  expect(compose).toContain('"443:443"');
  expect(compose).toContain('"443:443/udp"');
  expect(compose).toContain('./Caddyfile:/etc/caddy/Caddyfile:ro');
  expect(compose).toContain('caddy-data:/data');
  expect(compose).toContain('caddy-config:/config');
  expect(compose).toContain('restart: unless-stopped');
});
