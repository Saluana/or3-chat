import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { consumeRateLimit, provenanceStatement, validDashboardUpdateJob, validReleaseCheck, validStartInput } from '../assets/dashboard-operator.mjs';

const ASSET_ROOT = resolve(import.meta.dir, '../assets');
const RUNTIME_ENTRYPOINT = resolve(import.meta.dir, '../../../scripts/docker/runtime-entrypoint.mjs');
const DOCKERFILE = resolve(import.meta.dir, '../../../Dockerfile');
const DOCKERIGNORE = resolve(import.meta.dir, '../../../.dockerignore');
const CLOUD_CLI_SOURCE = resolve(import.meta.dir, '../src/cli.ts');
const DASHBOARD_OPERATOR = resolve(ASSET_ROOT, 'dashboard-operator.mjs');
const RELEASE_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/release-cloud.yml');
const DEVELOPMENT_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/tests.yml');
const DEV_COMPOSE = resolve(import.meta.dir, '../../../compose.dev.yaml');
const CANDIDATE_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/release-cloud-candidate.yml');
const CANDIDATE_RECEIPT = resolve(import.meta.dir, '../../../scripts/release/candidate-receipt.mjs');
const ROOT_MANIFEST = resolve(import.meta.dir, '../../../package.json');
const BROWSER_SMOKE = resolve(import.meta.dir, '../../../scripts/release/smoke-browser.mjs');
const DOCKER_SMOKE = resolve(import.meta.dir, '../../../scripts/release/smoke-create-docker.mjs');
const DASHBOARD_UPDATE_CARD = resolve(import.meta.dir, '../../../app/components/admin/system/AdminSystemUpdateCard.vue');

function asset(name: string): string {
  return readFileSync(resolve(ASSET_ROOT, name), 'utf8');
}

test('Caddyfile sets the full security header set inside the site block', () => {
  const caddyfile = asset('Caddyfile');
  const siteBlock = caddyfile.slice(caddyfile.indexOf('{'), caddyfile.lastIndexOf('}'));
  expect(siteBlock).toContain('Strict-Transport-Security "max-age=31536000"');
  expect(siteBlock).not.toContain('includeSubDomains');
  expect(siteBlock).toContain('X-Content-Type-Options "nosniff"');
  expect(siteBlock).toContain('X-Frame-Options "DENY"');
  expect(siteBlock).toContain('Referrer-Policy "strict-origin-when-cross-origin"');
  expect(siteBlock).toContain('Permissions-Policy "camera=(), microphone=(), geolocation=()"');
  expect(siteBlock).toContain("Content-Security-Policy \"default-src 'self'");
  expect(siteBlock).toContain("frame-ancestors 'none'");
  expect(siteBlock).toContain("connect-src 'self' https://openrouter.ai");
});

test('Caddyfile keeps SSE streaming and compression intact', () => {
  const caddyfile = asset('Caddyfile');
  expect(caddyfile).toContain('encode zstd gzip');
  expect(caddyfile).toContain('reverse_proxy or3:3000');
  // Caddy detects text/event-stream responses and flushes them immediately.
  // Avoid a negative explicit interval: it prevents the upstream request from
  // being cancelled when a client disconnects mid-generation.
  expect(caddyfile).not.toContain('flush_interval -1');
});

test('local compose.yaml has no Caddy service', () => {
  const compose = asset('compose.yaml');
  expect(compose).not.toMatch(/^\s*caddy:/m);
});

test('compose.yaml bridges managed proxy trust into Nuxt runtime config', () => {
  const compose = asset('compose.yaml');
  expect(compose).toContain('NUXT_SECURITY_PROXY_TRUST_PROXY: "${OR3_TRUST_PROXY:-false}"');
});

test('dashboard updates isolate Docker access to the operator sidecar', () => {
  const compose = asset('compose.yaml');
  const operator = asset('compose.operator.yaml');
  expect(compose).not.toContain('operator-ipc');
  expect(compose).not.toContain('/var/run/docker.sock');
  expect(operator).toContain('target: /run/or3-operator');
  expect(operator).toContain('target: /var/run/docker.sock');
  expect(operator).toContain('source: ./dashboard-operator.mjs');
  expect(operator).toContain('target: /operator/dashboard-operator.mjs');
  expect(operator).toContain('group_add:');
  expect(operator).toContain('io.or3.cloud.deployment-id: ${OR3_DEPLOYMENT_ID}');
  expect(operator).toContain('cap_drop:');
  expect(operator).toContain('- ALL');
  expect(operator).toContain('host-root-equivalent');
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  expect(cli).toContain('await chmod(ipc, 0o710);');
});

test('dashboard updates hand operator recreation to a separate helper container', () => {
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  const operator = readFileSync(DASHBOARD_OPERATOR, 'utf8');
  expect(cli).toContain("'run', '--detach', '--rm', '--network', 'none', '--read-only'");
  expect(cli).toContain("'--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL'");
  expect(cli).toContain("'--complete-handoff', jobId, project");
  expect(operator).toContain("process.argv[2] === '--complete-handoff'");
  expect(operator).toContain("['succeeded', 'failed', 'needs_attention'].includes(job.phase)");
  expect(operator).not.toContain("['rm', '--force', ...containerIds]");
  expect(operator).toContain("'up', '-d', '--no-deps', '--force-recreate', 'or3-operator'");
  expect(operator).toContain("'ps', '--status', 'running', '-q', 'or3-operator'");
});

test('dashboard operator verifies exact release provenance before executing package code', () => {
  const operator = readFileSync(DASHBOARD_OPERATOR, 'utf8');
  expect(operator).toContain("NPM_CONFIG_IGNORE_SCRIPTS: 'true'");
  expect(operator).toContain("NPM_CONFIG_USERCONFIG: join(installDirectory, 'disabled-user.npmrc')");
  expect(operator).toContain("NPM_CONFIG_GLOBALCONFIG: join(installDirectory, 'disabled-global.npmrc')");
  expect(operator).not.toContain("NPM_CONFIG_USERCONFIG: '/dev/null'");
  expect(operator).not.toContain("NPM_CONFIG_GLOBALCONFIG: '/dev/null'");
  expect(operator).toContain("'audit',\n    'signatures'");
  expect(operator).toContain("expectedWorkflow = '.github/workflows/release-cloud.yml'");
  expect(operator).toContain("expectedRepository = 'https://github.com/Saluana/or3-chat'");
  expect(operator).toContain("statement?.predicate?.runDetails?.builder?.id !== 'https://github.com/actions/runner/github-hosted'");
  expect(operator).toContain("entries.length !== 2");
  expect(operator).toContain("manifest?.or3Cloud?.imageDigest");
  expect(operator).toContain("manifest?.or3Cloud?.sourceRevision !== expectedRelease.sourceRevision");
  expect(operator).toContain("OR3_EXPECTED_IMAGE_DIGEST: imageDigest");
  expect(operator).toContain('The managed updater did not complete successfully: ${processDiagnostic(updated)}');
  expect(operator).toContain('The exact dashboard updater could not recover the interrupted operation: ${processDiagnostic(recovered)}');
  expect(operator).toContain("maxAttestationBytes = 1024 * 1024");
  expect(operator).toContain("await verify(bundle");
  expect(operator).toContain("npmRequire('sigstore')");
  expect(operator).toContain("await trustedProvenance(expectedRelease) !== provenanceFingerprint");
  expect(operator).toContain("const auditPath = join(cloudDirectory, 'dashboard-update-audit.jsonl')");
  expect(operator).toContain("await audit('update_accepted'");
  expect(operator).toContain('void chmod(socketPath, 0o660)');
  expect(operator).toContain('async function completeOperatorHandoff(jobId, project)');
  expect(operator).toContain("'up', '-d', '--no-deps', '--force-recreate', 'or3-operator'");
  expect(operator).not.toContain("'exec',\n    '--yes'");
  expect(operator).not.toContain('shell: true');
});

test('dashboard operator rejects loose payloads and reconciles interrupted jobs', () => {
  const operator = readFileSync(DASHBOARD_OPERATOR, 'utf8');
  expect(operator).toContain("keys.length === 2");
  expect(operator).toContain("requestIdPattern.test(input.requestId)");
  expect(operator).toContain('void reconcileInterruptedJob()');
  expect(operator).toContain('await runRecovery(job);');
  expect(operator).toContain("job.phase = 'needs_attention'");
  expect(operator).toContain("if (updateClaimed)");
});

test('dashboard operator accepts only the exact start payload contract', () => {
  const valid = {
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    targetVersion: '0.1.39',
  };
  expect(validStartInput(valid)).toBe(true);
  expect(validStartInput({ ...valid, command: 'docker system prune' })).toBe(false);
  expect(validStartInput({ ...valid, requestId: '../operator.sock' })).toBe(false);
  expect(validStartInput({ ...valid, targetVersion: '0.1.39 || true' })).toBe(false);
});

test('dashboard operator bounds mutation request rates', () => {
  const attempts: number[] = [];
  expect(consumeRateLimit(attempts, 1_000, 2, 1_000)).toBe(true);
  expect(consumeRateLimit(attempts, 1_100, 2, 1_000)).toBe(true);
  expect(consumeRateLimit(attempts, 1_200, 2, 1_000)).toBe(false);
  expect(consumeRateLimit(attempts, 2_001, 2, 1_000)).toBe(true);
});

test('dashboard update polling is bounded and announces state changes', () => {
  const card = readFileSync(DASHBOARD_UPDATE_CARD, 'utf8');
  expect(card).toContain('const ACTIVE_POLL_MS = 2000;');
  expect(card).toContain('const MAX_ACTIVE_POLL_MS = 15 * 60_000;');
  expect(card).toContain('const MAX_POLL_BACKOFF_MS = 30_000;');
  expect(card).toContain('role="status" aria-live="polite"');
  expect(card).toContain('role="alert" aria-live="assertive"');
  expect(card).not.toContain('setInterval');
});

test('dashboard operator persists only bounded release-check state', () => {
  const successful = {
    schemaVersion: 1,
    checkedAt: '2026-08-13T12:00:00.000Z',
    lastSuccessful: {
      checkedAt: '2026-08-13T12:00:00.000Z',
      latestVersion: '0.1.40',
      updateAvailable: true,
    },
  };
  expect(validReleaseCheck(successful)).toBe(true);
  expect(validReleaseCheck({ ...successful, injected: true })).toBe(false);
  expect(validReleaseCheck({ ...successful, failure: 'x'.repeat(4097) })).toBe(false);
});

test('dashboard operator accepts only bounded persisted job state', () => {
  const job = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    targetVersion: '0.1.40',
    phase: 'failed',
    startedAt: '2026-08-13T12:00:00.000Z',
    completedAt: '2026-08-13T12:05:00.000Z',
    error: 'update failed',
  };
  expect(validDashboardUpdateJob(job)).toBe(true);
  expect(validDashboardUpdateJob({ ...job, injected: true })).toBe(false);
  expect(validDashboardUpdateJob({ ...job, error: 'x'.repeat(4097) })).toBe(false);
});

test('dashboard operator binds provenance to the OR3 tagged release workflow', () => {
  const version = '0.1.39';
  const digestBytes = Buffer.alloc(64, 7);
  const expectedRelease = {
    version,
    integrity: `sha512-${digestBytes.toString('base64')}`,
    sourceRevision: 'a'.repeat(40),
  };
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{
      name: `pkg:npm/%40or3/cloud@${version}`,
      digest: { sha512: digestBytes.toString('hex') },
    }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            ref: `refs/tags/v${version}`,
            repository: 'https://github.com/Saluana/or3-chat',
            path: '.github/workflows/release-cloud.yml',
          },
        },
        resolvedDependencies: [{
          uri: `git+https://github.com/Saluana/or3-chat@refs/tags/v${version}`,
          digest: { gitCommit: 'a'.repeat(40) },
        }],
      },
      runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' } },
    },
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
  expect(provenanceStatement(encode(statement), expectedRelease)).toEqual(statement);
  const malicious = structuredClone(statement);
  malicious.predicate.buildDefinition.externalParameters.workflow.repository = 'https://github.com/attacker/or3-chat';
  expect(() => provenanceStatement(encode(malicious), expectedRelease)).toThrow('does not match the trusted release workflow');
  const wrongRevision = structuredClone(statement);
  wrongRevision.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'b'.repeat(40);
  expect(() => provenanceStatement(encode(wrongRevision), expectedRelease)).toThrow('does not match the trusted release workflow');
});

test('Dockerfile builds shared Nuxt output only once on the native runner', () => {
  const dockerfile = readFileSync(DOCKERFILE, 'utf8');
  expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM node:.* AS dependency-manifests$/m);
  expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM node:.* AS operator-npm$/m);
  expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM node:.* AS build$/m);
  expect(dockerfile).toMatch(/^FROM busybox:1\.37\.0-uclibc@sha256:.* AS runtime-tools$/m);
  expect(dockerfile).toMatch(/^FROM gcr\.io\/distroless\/nodejs24-debian13:.* AS runtime$/m);
  expect(dockerfile).toMatch(/^FROM docker:27\.5\.1-cli@sha256:.* AS docker-client$/m);
  expect(dockerfile).toMatch(/^FROM node:24-bookworm-slim@sha256:.* AS dashboard-operator$/m);
  const toolsStage = dockerfile.slice(dockerfile.indexOf('FROM busybox:'), dockerfile.indexOf('FROM docker:'));
  expect(toolsStage).not.toContain('\nRUN ');
  expect(dockerfile).toContain('COPY --from=runtime-tools /bin/ /bin/');
  expect(dockerfile).toContain('COPY --from=docker-client /usr/local/bin/docker /usr/local/bin/docker');
  expect(dockerfile).toContain('COPY --from=docker-client /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose');
  expect(dockerfile).toContain('COPY --from=docker-client /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt');
  const appRuntime = dockerfile.slice(dockerfile.indexOf(' AS runtime\n'), dockerfile.length);
  expect(appRuntime).not.toContain('COPY --from=docker-client');
  expect(appRuntime).not.toContain('/usr/local/lib/node_modules/npm');
  expect(dockerfile).toContain('ENTRYPOINT ["/nodejs/bin/node"');
  expect(dockerfile).toContain('npm pkg set version=0.0.0-docker-dependencies');
  expect(dockerfile).toContain('COPY --from=dependency-manifests /app/package.json /app/package-lock.json ./');
  expect(dockerfile).toContain('COPY --from=operator-npm /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm');
  expect(dockerfile).not.toContain('COPY package*.json bun.lock* ./');
});

test('Docker build context excludes generated CI and release evidence', () => {
  const ignored = readFileSync(DOCKERIGNORE, 'utf8').split(/\r?\n/);
  for (const path of ['output/', 'test-results/', 'playwright-report/', 'release-artifact/']) {
    expect(ignored).toContain(path);
  }
});

test('fixed-profile image declares the extension archive runtime', () => {
  const manifest = JSON.parse(readFileSync(ROOT_MANIFEST, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  expect(manifest.dependencies?.fflate).toBe('^0.8.3');
});

test('compose.yaml deep health treats degraded as unhealthy', () => {
  const compose = asset('compose.yaml');
  const healthcheck = compose.slice(compose.indexOf('healthcheck:'));
  expect(healthcheck).toContain('deep=true');
  expect(healthcheck).toContain('CMD-SHELL');
  expect(healthcheck).toContain('/nodejs/bin/node');
  expect(healthcheck).toContain('/usr/local/bin/node');
  expect(healthcheck).toContain("fs.openSync(p,'r+')");
  expect(healthcheck).toContain("b.status!=='ok'");
  expect(healthcheck).toContain('process.exit(1)');
  expect(healthcheck).toContain('interval: 10s');
  expect(healthcheck).toContain('timeout: 5s');
  expect(healthcheck).toContain('retries: 12');
  expect(healthcheck).toContain('start_period: 30s');
  expect(compose).toContain('stop_grace_period: 25s');
});

test('container-side CLI probes support current and legacy explicit Node paths', () => {
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  expect(cli).toContain("const CONTAINER_NODE = '/nodejs/bin/node';");
  expect(cli).toContain("const LEGACY_CONTAINER_NODE = '/usr/local/bin/node';");
  expect(cli).toContain("'sh', '-c', CONTAINER_NODE_SHELL, 'or3-node', script");
  expect(cli).not.toContain("'or3', 'node', '-e'");
  expect(cli).not.toContain("'or3', CONTAINER_NODE, '-e'");
});

test('public verification syncs canonical file metadata before downloading the storage probe', () => {
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  const verify = cli.slice(cli.indexOf('async function verifyPublicApplication'), cli.indexOf('function responseCookie'));
  expect(verify).toContain("'/api/storage/commit'");
  expect(verify).toContain("'/api/sync/push'");
  expect(verify).toContain("tableName: 'file_meta'");
  expect(verify).toContain("operation: 'put'");
  expect(verify).toContain('pushed.results?.[0]?.success !== true');
  expect(verify.indexOf("operation: 'put'")).toBeLessThan(verify.indexOf("'/api/storage/presign-download'"));
  expect(verify).toContain("operation: 'delete'");
  expect(verify).toContain('deleted.results?.[0]?.success !== true');
});

test('updates rebuild legacy-owned data from the checksummed backup without recursive chown', () => {
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  expect(cli).toContain('const MANAGED_RUNTIME_UID = 65532;');
  expect(cli).toContain("'--network', 'none', '--read-only', '--user', '0:0'");
  expect(cli).toContain("'--cap-drop', 'ALL', '--cap-add', 'CHOWN'");
  expect(cli).not.toContain('chown -R');
  const update = cli.slice(cli.indexOf('async function updateCommand'), cli.indexOf('async function resolveBackup'));
  expect(update).toContain('await setManagedVolumeRootOwnership(targetImage, state.volumeName, {');
  expect(update).toContain('await restoreVolumeArchive(loaded.directory, state.mode, nextEnv, backup.backupDir);');
  expect(update).toContain('await setManagedVolumeRootOwnership(targetImage, state.volumeName, previousRootOwnership);');
  expect(update.indexOf('await stopProject(loaded.directory, state.mode);')).toBeLessThan(update.indexOf('uid: MANAGED_RUNTIME_UID'));
});

test('credential reset keeps plaintext passwords out of Docker arguments', () => {
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  expect(cli).toContain("'-e', 'OR3_RESET_OWNER_PASSWORD'");
  expect(cli).toContain("'-e', 'OR3_RESET_ADMIN_PASSWORD'");
  expect(cli).not.toContain('`OR3_RESET_OWNER_PASSWORD=${values.ownerPassword}`');
  expect(cli).not.toContain('`OR3_RESET_ADMIN_PASSWORD=${values.adminPassword}`');
});

test('lifecycle commands are deadline-bound and power-loss durable', () => {
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  const operator = readFileSync(DASHBOARD_OPERATOR, 'utf8');
  expect(cli).toContain('timeout: COMMAND_TIMEOUT_MS');
  expect(cli).toContain('detached: process.platform');
  expect(cli).toContain("process.kill(-child.pid, 'SIGKILL')");
  expect(cli).toContain("await run('docker', ['info', '--format', '{{.Architecture}}'])");
  expect(cli).toContain('await durableRename(temporary, path)');
  expect(cli).toContain('await syncDirectory(dirname(destination))');
  expect(operator).toContain('await durableRename(temporary, jobPath)');
  expect(operator).toContain('await directory.sync()');
});

test('updates and recovery use journaled snapshots rather than resuming a partial target', () => {
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  expect(cli).toContain('const managedAssetSha256 = await snapshotManagedAssets(directory, state.mode, backupDir);');
  expect(cli).toContain('await copyAssets(loaded.directory, state.mode);');
  expect(cli).toContain('async function restorePreMutationSnapshot(');
  expect(cli).toContain("phase: 'target-mutating'");
  expect(cli).toContain('previousBackupPath: previous.backupDir');
  expect(cli).toContain('await restoreManagedAssets(directory, backupPath, manifest);');
  expect(cli).toContain('await verifiedManagedAssetContents(backupPath, manifest);');
  expect(cli).toContain('targetVersion !== PACKAGE_VERSION');
  expect(cli).toContain('Interrupted update was rolled back to pre-update snapshot');
});

test('restore and adoption stream private archives into the managed volume', () => {
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  expect(cli).toContain('pipeline(createReadStream(source), child.stdin)');
  expect(cli).toContain("'find /data -mindepth 1 -delete'");
  expect(cli).toContain("'tar xzf - -C /data'");
  expect(cli).toContain("'run', '--rm', '-i', '--network', 'none', '--read-only'");
  expect(cli).toContain("'-v', `${state.volumeName}:/data`");
  expect(cli).not.toContain("'run', '--rm', '-T', '--no-deps', '--user', '0:0', '--read-only'");
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

test('candidate verification reuses the exact built digest without rebuilding', () => {
  const workflow = readFileSync(CANDIDATE_WORKFLOW, 'utf8');
  expect(workflow).toContain('docker pull --platform linux/amd64 "$IMAGE@$IMAGE_DIGEST"');
  expect(workflow).toContain('/usr/local/bin/docker manifest inspect "$1"');
  expect(workflow).toContain('OR3_CLOUD_TEST_IMAGE="$CANDIDATE_IMAGE"');
  expect(workflow.match(/docker\/build-push-action@v6/g)?.length).toBe(2);
  expect(workflow).toContain('digest: ${{ steps.build-app.outputs.digest }}');
  expect(workflow).toContain('needs: [identity, source-validation, build-app, build-operator, package, image-contracts, security-scan, arm-runtime, lifecycle]');
  expect(workflow).toContain('cache-from: type=registry,ref=ghcr.io/saluana/or3-chat:buildcache-cloud');
  expect(workflow).toContain('cache-to: type=registry,ref=ghcr.io/saluana/or3-chat:buildcache-cloud,mode=max');
  expect(workflow).toContain('test "$(/usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js --version)" = 11.6.2');
});

test('development image is built once, smoked by digest, and only then tagged', () => {
  const workflow = readFileSync(DEVELOPMENT_WORKFLOW, 'utf8');
  const image = workflow.slice(workflow.indexOf('  dev-image:'), workflow.indexOf('  dev-smoke:'));
  const smoke = workflow.slice(workflow.indexOf('  dev-smoke:'), workflow.indexOf('  dev-publish:'));
  const publish = workflow.slice(workflow.indexOf('  dev-publish:'));
  expect(image.match(/docker\/build-push-action@v6/g)?.length).toBe(1);
  expect(image).toContain('needs: core');
  expect(image).toContain('buildcache-dev');
  expect(image).toContain('docker manifest inspect "$IMAGE"');
  expect(image).toContain('refusing to reuse or overwrite it');
  expect(image).toContain('platforms: ${{ steps.identity.outputs.platform }}');
  // Architectures must never share an immutable identity, and reuse must
  // distinguish a confirmed missing manifest from a registry failure.
  expect(image).toContain('image=ghcr.io/saluana/or3-chat:dev-$short-$arch');
  expect(image).toContain('Could not confirm whether $IMAGE exists');
  expect(image).toContain("grep -Eqi 'manifest unknown|name unknown|no such manifest|not found'");
  expect(image).toContain('docker pull --platform "$PLATFORM" "$IMAGE"');
  expect(image).toContain("actual_platform=\"$(docker image inspect --format '{{.Os}}/{{.Architecture}}' \"$IMAGE\")\"");
  expect(smoke).toContain('/api/health?deep=true');
  expect(smoke).toContain("docker inspect --format '{{.State.Running}}'");
  expect(smoke).toContain('smoke-create-docker.mjs');
  expect(smoke).toContain('--read-only');
  expect(smoke).toContain('--cap-drop ALL');
  expect(smoke).toContain('docker pull --platform "$PLATFORM" "$REF"');
  expect(smoke).toContain('--platform "$PLATFORM"');
  expect(smoke).toContain('docker rm -f or3-dev-smoke');
  expect(smoke).toContain('docker volume rm or3-dev-smoke-data');
  // dev-publish reads dev-image outputs, so dev-image must be a direct need.
  expect(publish).toContain('needs: [dev-image, dev-smoke]');
  expect(publish).toContain('tag="ghcr.io/saluana/or3-chat:dev-${ARCH}"');
  expect(publish).toContain('imagetools create -t "$tag" "$REF"');
  expect(publish).toContain('test "$published" = "$EXPECTED_DIGEST"');
  expect(workflow).not.toContain('npm publish');
  expect(workflow).not.toContain('contents: write');
  expect(workflow).not.toContain('release:prepare');
  expect(workflow).toContain("- 'plugins/**'");
  expect(workflow).toContain("github.ref == 'refs/heads/or3-cloud'");
});

test('development compose deployment is separate from managed installers', () => {
  const compose = readFileSync(DEV_COMPOSE, 'utf8');
  expect(compose).toContain('image: ${OR3_IMAGE:?');
  expect(compose).toContain('name: or3-dev');
  expect(compose).toContain('or3-dev-data:/data');
  expect(compose).toContain('deep=true');
  const effective = compose
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  expect(effective).not.toMatch(/^\s*or3-operator:/m);
  expect(effective).not.toContain('dashboard-operator');
  expect(effective).not.toContain('@or3/cloud');
});

test('clean browser smoke uses the explicit super-admin elevation route', () => {
  const smoke = readFileSync(BROWSER_SMOKE, 'utf8');
  expect(smoke).toContain("page.goto(`${baseUrl}/admin/login`, { waitUntil: 'domcontentloaded' })");
  expect(smoke).toContain("readFile(resolve('.or3-initial-credentials'), 'utf8')");
  expect(smoke).not.toContain("page.goto(`${baseUrl}/admin`, { waitUntil: 'commit' })");
});

test('clean browser smoke proves owner session hydration before leaving sign-in', () => {
  const smoke = readFileSync(BROWSER_SMOKE, 'utf8');
  const signIn = smoke.slice(
    smoke.indexOf('async function signInOwner'),
    smoke.indexOf('async function verifyAdminAccess'),
  );
  const submit = signIn.indexOf("dialog.locator('button[type=\"submit\"]').click()");
  const session = signIn.indexOf('waitForOwnerSession(page, email)');
  const shell = signIn.indexOf("page.locator('#chat-input-main')");
  expect(submit).toBeGreaterThan(-1);
  expect(session).toBeGreaterThan(submit);
  expect(shell).toBeGreaterThan(session);
});

test('release digest verification uses buildx-compatible manifest output', () => {
  const workflow = readFileSync(RELEASE_WORKFLOW, 'utf8');
  expect(workflow).not.toContain('.Index.Digest');
  expect(workflow).toContain('candidate-receipt.mjs verify');
  expect(workflow).toContain('imagetools create --tag "$RELEASE_IMAGE" "$candidate_image@$candidate_digest"');
  expect(workflow).not.toContain('docker/build-push-action');
  expect(workflow).toContain('dashboard-lifecycle:');
  expect(workflow).toContain('smoke-dashboard-update.mjs');
  expect(workflow).toContain('npx --yes "@or3/cloud@$PREVIOUS_VERSION" verify');
  expect(workflow).toContain('No earlier dashboard-compatible release satisfies minimum source');
});

test('npm publication identifies the qualified tarball as a local file', () => {
  const workflow = readFileSync(RELEASE_WORKFLOW, 'utf8');
  const publishJob = workflow.slice(
    workflow.indexOf('  publish-npm:'),
    workflow.indexOf('  dashboard-lifecycle:'),
  );
  expect(workflow).toContain(
    'npm publish "./release-artifact/or3-cloud-$VERSION.tgz" --access public',
  );
  expect(workflow).toContain('already published with the qualified immutable tarball; continuing verification.');
  expect(publishJob).toContain('packages: read');
  expect(publishJob.indexOf('docker/login-action@v3')).toBeLessThan(
    publishJob.indexOf('Re-verify promoted image and exact package'),
  );
  expect(publishJob).toContain('for attempt in $(seq 1 60)');
  expect(publishJob).toContain('actual="$(resolve_digest "ghcr.io/saluana/or3-chat:$VERSION")"');
  expect(publishJob).toContain('actual_operator="$(resolve_digest "ghcr.io/saluana/or3-chat:$VERSION-operator")"');
  expect(publishJob).not.toMatch(/imagetools inspect .*\| awk/);
});

test('candidate evidence is source-qualified and cannot publish a release', () => {
  const candidate = readFileSync(CANDIDATE_WORKFLOW, 'utf8');
  expect(candidate).toContain('candidate-$VERSION-$source_sha');
  expect(candidate).toContain('candidate-operator-$VERSION-$source_sha');
  expect(candidate).toContain('candidate-evidence-$VERSION-$source_sha');
  expect(candidate).toContain('source_sha="$(git rev-parse HEAD)"');
  expect(candidate).toContain('bun run release:prepare -- --version "$VERSION" --registry');
  expect(candidate).not.toContain('bun run release:prepare -- --version "$VERSION" --registry --full');
  expect(candidate.indexOf('assert_image_missing "$candidate"')).toBeLessThan(candidate.indexOf('bun install --frozen-lockfile'));
  expect(candidate).toContain('or3 verify');
  expect(candidate).not.toContain('npm publish');
  expect(candidate).not.toContain('contents: write');
});

test('authenticated cloud package binds updates to the qualified image digest', () => {
  const candidate = readFileSync(CANDIDATE_WORKFLOW, 'utf8');
  const receipt = readFileSync(CANDIDATE_RECEIPT, 'utf8');
  const cli = readFileSync(CLOUD_CLI_SOURCE, 'utf8');
  expect(candidate).toContain('npm pkg set "or3Cloud.imageDigest=$IMAGE_DIGEST"');
  expect(candidate).toContain('npm pkg set "or3Cloud.operatorImageDigest=$OPERATOR_IMAGE_DIGEST"');
  expect(candidate).toContain('npm pkg set "or3Cloud.sourceRevision=$SOURCE_REVISION"');
  expect(candidate.indexOf('docker/build-push-action@v6')).toBeLessThan(candidate.indexOf('npm pkg set "or3Cloud.imageDigest=$IMAGE_DIGEST"'));
  expect(receipt).toContain("packageManifest.or3Cloud?.imageDigest !== candidateDigest");
  expect(receipt).toContain("packageManifest.or3Cloud?.imageDigest !== receipt.candidateDigest");
  expect(receipt).toContain("packageManifest.or3Cloud?.operatorImageDigest !== receipt.operatorCandidateDigest");
  expect(receipt).toContain("packageManifest.or3Cloud?.sourceRevision !== receipt.sourceSha");
  expect(cli).toContain('pullImage(targetImageTag, expectedImageDigest(targetVersion))');
  expect(cli).toContain('revision.toLowerCase() !== expectedRevision');
  expect(cli).toContain('const targetImage = imageAtDigest(targetImageTag, targetDigest);');
  expect(cli).toContain('await assertRunningAppImage(directory, mode, env.OR3_IMAGE);');
  expect(cli).toContain('The image tag may have been replaced; refusing to continue.');
});

test('candidate qualification runs against the final digest-bound manifest', () => {
  const candidate = readFileSync(CANDIDATE_WORKFLOW, 'utf8');
  const binding = candidate.indexOf('npm pkg set "or3Cloud.imageDigest=$IMAGE_DIGEST"');
  const qualification = candidate.indexOf('bun run check', binding);
  const packing = candidate.indexOf('npm pack --ignore-scripts', binding);
  expect(binding).toBeGreaterThan(-1);
  expect(qualification).toBeGreaterThan(binding);
  expect(packing).toBeGreaterThan(qualification);
  expect(candidate).toContain("tar -tzf \"$tarball\" | grep -x 'package/LICENSE' >/dev/null");
});

test('candidate qualification leaves deep browser and host builds off the critical path', () => {
  const candidate = readFileSync(CANDIDATE_WORKFLOW, 'utf8');
  expect(candidate).not.toContain('bunx playwright install --with-deps chromium');
  expect(candidate).not.toContain('bun run build');
  expect(candidate).not.toContain('performance:production-build:check');
  expect(candidate).toContain('Build and push the application image once');
});

test('release storage smokes persist canonical metadata before download', () => {
  for (const smokePath of [DOCKER_SMOKE, BROWSER_SMOKE]) {
    const smoke = readFileSync(smokePath, 'utf8');
    const commit = smoke.indexOf("'/api/storage/commit'");
    const sync = smoke.indexOf("'/api/sync/push'", commit);
    const download = smoke.indexOf("'/api/storage/presign-download'", sync);
    expect(commit).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(commit);
    expect(download).toBeGreaterThan(sync);
  }
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
    'NUXT_ADMIN_AUTH_JWT_SECRET',
    'NUXT_BACKGROUND_JOBS_ENABLED',
    'NUXT_PUBLIC_BACKGROUND_STREAMING_ENABLED',
    'NUXT_BACKGROUND_JOBS_STORAGE_PROVIDER',
    'NUXT_BACKGROUND_JOBS_MAX_CONCURRENT_JOBS',
    'NUXT_BACKGROUND_JOBS_MAX_CONCURRENT_JOBS_PER_USER',
    'NUXT_BACKGROUND_JOBS_JOB_TIMEOUT_MS',
    'NUXT_BACKGROUND_JOBS_ENCRYPTION_KEY',
    'NUXT_ADMIN_PLUGIN_CONNECTION_SECRET',
    'NUXT_ADMIN_LIBRARY_LINK_SECRET',
    'NUXT_ADMIN_PLUGIN_ALLOWED_MODELS',
    'NUXT_ADMIN_PLUGIN_MODEL_PRICES'
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
      OR3_BACKGROUND_STREAMING_ENABLED: 'true',
      OR3_BACKGROUND_STREAMING_PROVIDER: 'convex',
      OR3_BACKGROUND_MAX_JOBS: '8',
      OR3_BACKGROUND_MAX_JOBS_PER_USER: '3',
      OR3_BACKGROUND_JOB_TIMEOUT: '45',
      OR3_BASIC_AUTH_JWT_SECRET: 'basic-auth-secret',
      OR3_BACKGROUND_ENCRYPTION_KEY: 'runtime-background-secret-at-least-32-characters',
      OR3_PLUGIN_CONNECTION_SECRET: 'runtime-plugin-connection-secret',
      OR3_LIBRARY_LINK_SECRET: 'runtime-library-link-secret',
      OR3_PLUGIN_ALLOWED_MODELS: 'vendor/alpha,vendor/beta',
      OR3_PLUGIN_MODEL_PRICES: '{"vendor/alpha":{"promptPerMillion":1,"completionPerMillion":2}}',
      NUXT_ADMIN_AUTH_JWT_SECRET: 'explicit-admin-secret',
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
    NUXT_ADMIN_AUTH_JWT_SECRET: 'explicit-admin-secret',
    NUXT_BACKGROUND_JOBS_ENABLED: 'true',
    NUXT_PUBLIC_BACKGROUND_STREAMING_ENABLED: 'true',
    NUXT_BACKGROUND_JOBS_STORAGE_PROVIDER: 'convex',
    NUXT_BACKGROUND_JOBS_MAX_CONCURRENT_JOBS: '8',
    NUXT_BACKGROUND_JOBS_MAX_CONCURRENT_JOBS_PER_USER: '3',
    NUXT_BACKGROUND_JOBS_JOB_TIMEOUT_MS: '45000',
    NUXT_BACKGROUND_JOBS_ENCRYPTION_KEY: 'runtime-background-secret-at-least-32-characters',
    NUXT_ADMIN_PLUGIN_CONNECTION_SECRET: 'runtime-plugin-connection-secret',
    NUXT_ADMIN_LIBRARY_LINK_SECRET: 'runtime-library-link-secret',
    NUXT_ADMIN_PLUGIN_ALLOWED_MODELS: 'vendor/alpha,vendor/beta',
    NUXT_ADMIN_PLUGIN_MODEL_PRICES: '{"vendor/alpha":{"promptPerMillion":1,"completionPerMillion":2}}'
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
