import { basename, resolve } from 'node:path';
import { adoptCommand } from '../commands/adopt';
import { backupCommand } from '../commands/backup';
import { credentialsCommand } from '../commands/credentials';
import { doctorCommand } from '../commands/doctor';
import { initCommand } from '../commands/init';
import { restartCommand, startCommand, stopCommand } from '../commands/lifecycle';
import { recoverCommand } from '../commands/recover';
import { removeCommand } from '../commands/remove';
import { restoreCommand } from '../commands/restore';
import { rollbackCommand } from '../commands/rollback';
import { logsCommand, statusCommand } from '../commands/status';
import { updateCommand, updatePreviewCommand } from '../commands/update';
import { verifyCommand, verifyReadOnlyCommand } from '../commands/verify';
import { type Flags, type ParsedArgs, boolFlag, requireStringFlag, verifyIsReadOnly } from './args';

export const MUTATING_COMMANDS = new Set([
  'init',
  'update',
  'backup',
  'verify',
  'restore',
  'rollback',
  'credentials',
  'recover',
  'adopt',
  'start',
  'stop',
  'restart',
  'remove',
]);

export function mutationDirectory(command: string, positionals: string[], flags: Flags) {
  if (command === 'init') return resolve(process.cwd(), positionals[0] ?? 'or3-cloud');
  if (command === 'adopt') {
    const sourceDirectory = requireStringFlag(flags, 'from');
    return resolve(process.cwd(), positionals[0] ?? `${basename(sourceDirectory)}-managed`);
  }
  return process.cwd();
}

/**
 * Read-only previews and verification bypass the deployment lease entirely;
 * they must never acquire, reclaim, or rewrite the single-writer lock.
 */
export function requiresMutationLease(command: string, parsed: ParsedArgs) {
  const readOnlyInvocation = (command === 'verify' && verifyIsReadOnly(parsed.flags))
    || (command === 'update' && boolFlag(parsed.flags, 'dry-run'))
    || (command === 'recover' && boolFlag(parsed.flags, 'dry-run'))
    // Backup inventory is an observation: it must not acquire or reclaim the
    // mutation lease while an operation is pending.
    || (command === 'backup' && parsed.positionals[0] === 'list');
  return !readOnlyInvocation && MUTATING_COMMANDS.has(command);
}

export async function dispatchCommand(command: string, parsed: ParsedArgs) {
  if (command === 'init') return await initCommand(parsed.positionals, parsed.flags);
  if (command === 'update') {
    if (boolFlag(parsed.flags, 'dry-run')) return await updatePreviewCommand(process.cwd(), parsed.flags);
    return await updateCommand(process.cwd(), parsed.flags);
  }
  if (command === 'backup') return await backupCommand(process.cwd(), parsed.positionals, parsed.flags);
  if (command === 'restore') return await restoreCommand(process.cwd(), parsed.flags, parsed.positionals);
  if (command === 'rollback') return await rollbackCommand(process.cwd(), parsed.flags);
  if (command === 'credentials') return await credentialsCommand(process.cwd(), parsed.positionals, parsed.flags);
  if (command === 'doctor') return await doctorCommand(process.cwd());
  if (command === 'verify') {
    if (verifyIsReadOnly(parsed.flags)) return await verifyReadOnlyCommand(process.cwd(), parsed.flags);
    return await verifyCommand(process.cwd(), parsed.flags, parsed.positionals);
  }
  if (command === 'recover') return await recoverCommand(process.cwd(), parsed.flags);
  if (command === 'adopt') return await adoptCommand(parsed.positionals, parsed.flags);
  if (command === 'status') return await statusCommand(process.cwd(), parsed.flags);
  if (command === 'logs') return await logsCommand(process.cwd(), parsed.flags, parsed.positionals);
  if (command === 'start') return await startCommand(process.cwd());
  if (command === 'stop') return await stopCommand(process.cwd());
  if (command === 'restart') return await restartCommand(process.cwd());
  if (command === 'remove') return await removeCommand(process.cwd(), parsed.flags);
  throw new Error(`Unknown command "${command}". Run npx @or3/cloud --help.`);
}
