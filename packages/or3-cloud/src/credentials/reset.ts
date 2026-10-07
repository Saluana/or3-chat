import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManagedState, Mode } from '../deployment/contracts';
import { serializeEnv, withoutProvisioningCredentials } from '../deployment/env';
import { deploymentPaths } from '../deployment/paths';
import { composeProcessEnv, run } from '../runtime/command-runner';
import { composeArgs } from '../runtime/compose';
import { containerNodeCommand } from '../runtime/health';
import { startProject, stopProject } from '../runtime/project';
import { writeSecure } from '../util/fs';
import { redact } from '../util/primitives';
import { buildCredentialsResetScript, CREDENTIALS_VERIFY_SCRIPT } from './reset-script';

function credentialResetValues(env: Record<string, string>) {
  const ownerEmail = env.OR3_MANAGED_OWNER_EMAIL || env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  const ownerPassword = env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD;
  const adminUsername = env.OR3_ADMIN_USERNAME;
  const adminPassword = env.OR3_ADMIN_PASSWORD;
  if (!ownerEmail || !ownerPassword || !adminUsername || !adminPassword) {
    throw new Error('Credential recovery data is incomplete. Run doctor and restore a backup rather than guessing credentials.');
  }
  return { ownerEmail, ownerPassword, adminUsername, adminPassword };
}

async function runCredentialsResetScript(directory: string, mode: Mode, values: ReturnType<typeof credentialResetValues>) {
  const script = buildCredentialsResetScript(values);
  const resetEnvironment = {
    ...composeProcessEnv(directory),
    OR3_RESET_OWNER_EMAIL: values.ownerEmail,
    OR3_RESET_OWNER_PASSWORD: values.ownerPassword,
    OR3_RESET_ADMIN_USERNAME: values.adminUsername,
    OR3_RESET_ADMIN_PASSWORD: values.adminPassword,
  };
  const result = await run('docker', [
    ...composeArgs(directory, mode, [
      'exec', '-T',
      '-e', 'OR3_RESET_OWNER_EMAIL',
      '-e', 'OR3_RESET_OWNER_PASSWORD',
      '-e', 'OR3_RESET_ADMIN_USERNAME',
      '-e', 'OR3_RESET_ADMIN_PASSWORD',
      'or3', ...containerNodeCommand(script),
    ]),
  ], directory, resetEnvironment);
  if (!result.ok) throw new Error(`${result.command}\n${redact(result.stderr, [values.ownerPassword, values.adminPassword])}`);
}

async function verifyCredentialsInsideContainer(directory: string, mode: Mode, values: ReturnType<typeof credentialResetValues>) {
  const resetEnvironment = {
    ...composeProcessEnv(directory),
    OR3_RESET_OWNER_EMAIL: values.ownerEmail,
    OR3_RESET_OWNER_PASSWORD: values.ownerPassword,
    OR3_RESET_ADMIN_USERNAME: values.adminUsername,
    OR3_RESET_ADMIN_PASSWORD: values.adminPassword,
  };
  const result = await run('docker', [
    ...composeArgs(directory, mode, [
      'exec', '-T',
      '-e', 'OR3_RESET_OWNER_EMAIL',
      '-e', 'OR3_RESET_OWNER_PASSWORD',
      '-e', 'OR3_RESET_ADMIN_USERNAME',
      '-e', 'OR3_RESET_ADMIN_PASSWORD',
      'or3', ...containerNodeCommand(CREDENTIALS_VERIFY_SCRIPT),
    ]),
  ], directory, resetEnvironment);
  if (!result.ok) throw new Error(`Credential verification inside the OR3 container failed. ${redact(result.stderr, [values.ownerPassword, values.adminPassword])}`);
}

export async function applyCredentialReset(directory: string, state: ManagedState, nextEnv: Record<string, string>) {
  const values = credentialResetValues(nextEnv);
  const running = await run('docker', [...composeArgs(directory, state.mode, ['ps', '-q', 'or3'])], directory);
  if (!running.ok || !running.stdout.trim()) {
    // A process interruption may have written the operation journal before the
    // first mutation. Start the intended configuration and replay the reset;
    // the database operation is idempotent for the requested credentials.
    await writeSecure(deploymentPaths(directory).env, serializeEnv(nextEnv));
    await startProject(directory, state.mode, nextEnv);
  }
  await runCredentialsResetScript(directory, state.mode, values);
  const runtimeEnv = withoutProvisioningCredentials(nextEnv);
  await writeSecure(deploymentPaths(directory).env, serializeEnv(runtimeEnv));
  const initialCredentials = join(directory, '.or3-initial-credentials');
  // The caller supplied the new values; retaining another credential copy
  // after rotation only expands the secret blast radius.
  await rm(initialCredentials, { force: true });
  await stopProject(directory, state.mode);
  await startProject(directory, state.mode, runtimeEnv);
  await verifyCredentialsInsideContainer(directory, state.mode, values);
}
