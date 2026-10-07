import { boolFlag, type Flags } from '../cli/args';
import { resolveResetPasswords } from '../credentials/inputs';
import { applyCredentialReset } from '../credentials/reset';
import type { PendingOperation } from '../deployment/contracts';
import { secretValues } from '../deployment/env';
import { assertDeploymentDirectoryIdentity } from '../deployment/identity';
import {
  assertNoPending,
  clearPending,
  loadManaged,
  markPending,
  writeState,
} from '../deployment/state-store';
import { ensureDocker } from '../runtime/docker';
import { id, now, randomSecret, redact } from '../util/primitives';

async function credentialsResetCommand(directory: string, flags: Flags) {
  if (!boolFlag(flags, 'yes')) throw new Error('Credentials reset changes the owner password, revokes all app sessions, and changes the admin password. Re-run with --yes after confirming the impact.');
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  assertNoPending(loaded.state);
  const ownerEmail = loaded.env.OR3_MANAGED_OWNER_EMAIL || loaded.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  const adminUsername = loaded.env.OR3_ADMIN_USERNAME;
  if (!ownerEmail) throw new Error('The managed owner email is missing from .env, so the owner account cannot be reset.');
  if (!adminUsername) throw new Error('OR3_ADMIN_USERNAME is missing from .env, so the admin password cannot be reset.');
  const { ownerPassword, adminPassword } = await resolveResetPasswords(flags);
  const nextEnv = {
    ...loaded.env,
    OR3_MANAGED_OWNER_EMAIL: ownerEmail,
    OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: ownerPassword,
    OR3_ADMIN_PASSWORD: adminPassword,
    // Rotating the admin JWT secret invalidates every previously issued admin
    // session cookie; admin auth is per-request basic auth over JWT cookies
    // with no persistent session table to revoke.
    OR3_ADMIN_JWT_SECRET: randomSecret(),
  };
  const pending: PendingOperation = {
    id: id('credentials-reset'),
    operation: 'credentials-reset',
    startedAt: now(),
    message: 'Resetting owner and admin credentials',
    credentialReset: { nextEnv },
  };
  await markPending(loaded.directory, loaded.state, pending);
  try {
    await applyCredentialReset(loaded.directory, loaded.state, nextEnv);
    await clearPending(loaded.directory, loaded.state);
    console.log('Owner and admin credentials are now separate. The old owner password and all app sessions were revoked.');
    console.log('Admin session cookies were invalidated by rotating OR3_ADMIN_JWT_SECRET. New passwords persist only as account hashes; sign in again with them.');
  } catch (error) {
    loaded.state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv));
    await writeState(loaded.directory, loaded.state);
    throw new Error(`${loaded.state.lastError}\nCredential reset is recoverable: run \"npx @or3/cloud recover\" to replay the intended protected operation.`);
  }
}

export async function credentialsCommand(directory: string, positionals: string[], flags: Flags) {
  const subcommand = positionals[0];
  if (subcommand !== 'reset') {
    throw new Error(`Unknown credentials subcommand "${subcommand ?? ''}". Use "npx @or3/cloud credentials reset --yes".`);
  }
  if (positionals.length > 1) throw new Error('credentials reset accepts no arguments.');
  return await credentialsResetCommand(directory, flags);
}
