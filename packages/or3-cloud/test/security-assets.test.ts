import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ASSET_ROOT = resolve(import.meta.dir, '../assets');
const RUNTIME_ENTRYPOINT = resolve(import.meta.dir, '../../../scripts/docker/runtime-entrypoint.sh');

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

test('compose.yaml deep health treats degraded as unhealthy', () => {
  const compose = asset('compose.yaml');
  const healthcheck = compose.slice(compose.indexOf('healthcheck:'));
  expect(healthcheck).toContain('deep=true');
  expect(healthcheck).toContain("b.status!=='ok'");
  expect(healthcheck).toContain('process.exit(1)');
  expect(healthcheck).toContain('interval: 10s');
  expect(healthcheck).toContain('timeout: 5s');
  expect(healthcheck).toContain('retries: 12');
  expect(healthcheck).toContain('start_period: 30s');
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
  expect(entrypoint).toContain('registration_mode=${OR3_AUTH_REGISTRATION_MODE:-open}');
  expect(entrypoint).toContain('NUXT_AUTH_REGISTRATION_MODE');
  expect(entrypoint).toContain('auto_provision=${OR3_AUTH_AUTO_PROVISION:-true}');
  expect(entrypoint).toContain('NUXT_AUTH_AUTO_PROVISION');
  expect(entrypoint).toContain('bootstrap_email=${OR3_BASIC_AUTH_BOOTSTRAP_EMAIL:-}');
  expect(entrypoint).toContain('NUXT_AUTH_BOOTSTRAP_EMAIL');
  expect(entrypoint).toContain('invite_token_secret=${OR3_AUTH_INVITE_TOKEN_SECRET:-}');
  expect(entrypoint).toContain('NUXT_AUTH_INVITE_TOKEN_SECRET');
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
