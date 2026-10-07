import { join, resolve } from 'node:path';
import { boolFlag, type Flags, stringFlag } from '../cli/args';
import { validateEmail } from '../credentials/inputs';
import type { CheckResult } from '../deployment/contracts';
import { parseEnv, secretValues } from '../deployment/env';
import { assertDeploymentDirectoryIdentity } from '../deployment/identity';
import { observationFindings, observeDeployment } from '../deployment/observation';
import { assertNoPending, loadManaged } from '../deployment/state-store';
import { run } from '../runtime/command-runner';
import { composeArgs } from '../runtime/compose';
import { ensureDocker } from '../runtime/docker';
import { containerNodeCommand, VERIFY_DATABASES_SCRIPT, waitForDeepHealth } from '../runtime/health';
import { imageDigest } from '../runtime/images';
import {
  validateVerificationHealth,
  verificationFetch,
  verificationJson,
  verifyPublicApplication,
} from '../runtime/verification';
import { fileExists, readOwnerOnlyText } from '../util/fs';
import { redact } from '../util/primitives';

async function verificationCredentials(directory: string, flags: Flags, env: Record<string, string>) {
  const passwordFile = stringFlag(flags, 'verification-password-file');
  if (flags['verification-email'] !== undefined && !stringFlag(flags, 'verification-email')) {
    throw new Error('--verification-email requires a value.');
  }
  if (flags['verification-password-file'] !== undefined && !passwordFile) {
    throw new Error('--verification-password-file requires a path.');
  }
  const configuredEmail = stringFlag(flags, 'verification-email')?.trim()
    || env.OR3_MANAGED_OWNER_EMAIL
    || env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  let initialCredentials: Record<string, string> = {};
  if ((!configuredEmail || (!passwordFile && !env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD))) {
    const initialCredentialsPath = join(directory, '.or3-initial-credentials');
    if (await fileExists(initialCredentialsPath)) {
      initialCredentials = parseEnv(await readOwnerOnlyText(initialCredentialsPath, 'The initial credentials file'));
    }
  }
  const email = configuredEmail || initialCredentials.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  if (!email) throw new Error('A current owner email is required for verification.');
  validateEmail(email);
  const password = passwordFile
    ? (await readOwnerOnlyText(resolve(passwordFile), 'The verification password file')).trim()
    : env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD || initialCredentials.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD;
  if (!password) {
    throw new Error('A current owner password is required. Pass --verification-password-file after changing the bootstrap password.');
  }
  if (password.includes('\0') || /\r|\n/.test(password)) throw new Error('The verification password file must contain exactly one password line.');
  return { email, password };
}

export async function verifyCommand(directory: string, flags: Flags, positionals: string[]) {
  if (positionals.length) throw new Error('verify accepts no positional arguments.');
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  assertNoPending(loaded.state);
  if (boolFlag(flags, 'public') && loaded.state.mode !== 'public') {
    throw new Error('--public requires a managed public deployment.');
  }
  if (loaded.env.OR3_VERSION !== loaded.state.appVersion || loaded.env.OR3_IMAGE !== loaded.state.image) {
    throw new Error('Managed state and .env version/image do not match.');
  }
  const digest = await imageDigest(loaded.state.image);
  if (digest !== loaded.state.imageDigest) {
    throw new Error(`Managed image digest differs from state. Expected ${loaded.state.imageDigest}, found ${digest}.`);
  }
  await waitForDeepHealth(loaded.directory, loaded.state.mode, secretValues(loaded.env));
  const baseUrl = new URL(
    loaded.state.mode === 'public'
      ? `https://${loaded.state.domain}`
      : `http://127.0.0.1:${loaded.state.port}`,
  );
  const verification = await verifyPublicApplication(baseUrl, await verificationCredentials(loaded.directory, flags, loaded.env));
  const databaseCheck = await run('docker', [
    ...composeArgs(loaded.directory, loaded.state.mode, ['exec', '-T', 'or3', ...containerNodeCommand(VERIFY_DATABASES_SCRIPT)]),
  ], loaded.directory);
  if (!databaseCheck.ok) throw new Error(`SQLite integrity or runtime proxy verification failed. ${databaseCheck.stderr.trim()}`);
  const databases = JSON.parse(databaseCheck.stdout.trim()) as Array<{ path: string; quickCheck: string; tables: number }>;
  if (databases.length !== 2 || databases.some((entry) => entry.quickCheck !== 'ok' || entry.tables < 1)) {
    throw new Error('SQLite verification did not confirm both managed databases.');
  }
  const services = loaded.state.mode === 'public' ? ['or3', 'caddy'] : ['or3'];
  const logs = await run('docker', composeArgs(loaded.directory, loaded.state.mode, [
    'logs', '--no-color', '--since', '10m', '--tail', '250', ...services,
  ]), loaded.directory);
  if (!logs.ok) throw new Error(`Could not read bounded deployment logs. ${logs.stderr.trim()}`);
  const serious = `${logs.stdout}\n${logs.stderr}`.split(/\r?\n/).filter((line) =>
    /\b(?:fatal|panic|oomkilled)\b|unhandled (?:rejection|exception)|out of memory/i.test(line),
  );
  if (serious.length) throw new Error(`Recent deployment logs contain serious errors:\n${redact(serious.slice(-20).join('\n'), secretValues(loaded.env))}`);
  console.log(`✓ OR3 ${loaded.state.appVersion} image digest matches managed state`);
  console.log(`✓ ${baseUrl.origin} root and deep health return HTTP 200 without redirects`);
  console.log('✓ Basic Auth sign-in, session hydration, and SQLite sync pull passed');
  console.log(verification.physicalCleanupDeferred
    ? '✓ Filesystem storage write/read and canonical metadata cleanup passed; physical cleanup deferred by provider retention policy'
    : '✓ Filesystem storage write/read and canonical/physical cleanup passed');
  console.log('✓ auth.sqlite and sync.sqlite quick_check passed with managed ownership');
  console.log('✓ Recent bounded logs contain no fatal, panic, unhandled, or OOM events');
  console.log('OR3 production verification passed.');
}

/**
 * Explicitly read-only verification (R4.AC1–AC2). It never acquires or
 * reclaims the lease, logs in, uploads probes, opens SQLite read/write, pulls
 * images, creates helper containers, or repairs files. Checks that would
 * require one of those are reported as deferred/unknown instead of passed.
 */
export async function verifyReadOnlyCommand(directory: string, flags: Flags) {
  const observation = await observeDeployment(directory, { checkDocker: true, checkImage: true });
  const state = observation.state;
  if (!state) {
    throw new Error(`Read-only verification needs readable managed state.${observation.stateError ? ` ${observation.stateError}` : ''} Run "npx @or3/cloud doctor" for diagnostics.`);
  }
  if (boolFlag(flags, 'public') && state.mode !== 'public') throw new Error('--public requires a managed public deployment.');
  const checks: CheckResult[] = [];
  const findings = observationFindings(observation);

  checks.push(observation.identityMatches === true
    ? { code: 'image-digest', status: 'passed', detail: `Recorded digest matches the local image (${state.imageDigest}).` }
    : observation.identityMatches === false
      ? { code: 'image-digest', status: 'failed', detail: `Recorded ${observation.recordedImageDigest} does not match local ${observation.actualImageDigest}.` }
      : { code: 'image-digest', status: 'unknown', detail: 'The managed image could not be inspected safely.' });

  const baseUrl = new URL(
    state.mode === 'public' ? `https://${state.domain}` : `http://127.0.0.1:${state.port}`,
  );
  try {
    const root = await verificationFetch(baseUrl);
    checks.push(root.status === 200
      ? { code: 'http-root', status: 'passed', detail: `${baseUrl.origin} returned HTTP 200 without redirects.` }
      : { code: 'http-root', status: 'failed', detail: `${baseUrl.origin} returned HTTP ${root.status}.` });
  } catch (error) {
    checks.push({ code: 'http-root', status: 'failed', detail: redact(error instanceof Error ? error.message : String(error)) });
  }
  try {
    validateVerificationHealth(await verificationJson(baseUrl, '/api/health?deep=true'));
    checks.push({ code: 'deep-health', status: 'passed', detail: 'Deep health reports the managed Basic Auth + SQLite + filesystem profile.' });
  } catch (error) {
    checks.push({ code: 'deep-health', status: 'failed', detail: redact(error instanceof Error ? error.message : String(error)) });
  }
  // Deliberately skipped (not failures): these require writes, credentials, or
  // container exec, so read-only verification reports them as deferred and does
  // not fail the run for them.
  checks.push({ code: 'auth-and-storage-journey', status: 'deferred', detail: 'Sign-in, sync, and storage probes are excluded from read-only verification.' });
  checks.push({ code: 'sqlite-integrity', status: 'deferred', detail: 'SQLite inspection is deferred because a safe read-only mechanism is unavailable.' });
  checks.push({ code: 'bounded-logs', status: 'deferred', detail: 'Log scanning is deliberately skipped by read-only verification; run full verify for it.' });

  if (boolFlag(flags, 'json')) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      kind: 'or3-verify-read-only',
      observedAt: observation.observedAt,
      directory: observation.directory,
      readOnly: true,
      checks,
      findings,
    }, null, 2));
  } else {
    for (const check of checks) console.log(`  [${check.status}] ${check.code}: ${check.detail}`);
    for (const finding of findings) console.log(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
  }
  // Only an actual failure is nonzero. Deliberately deferred/skipped checks and
  // an inconclusive (unknown) observation must not fail a read-only run.
  if (checks.some((check) => check.status === 'failed')) {
    process.exitCode = 1;
  }
}
