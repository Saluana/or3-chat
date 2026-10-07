export type Flags = Record<string, string | boolean>;

export type ParsedArgs = ReturnType<typeof parseFlags>;

/**
 * Switches never take a value: `--flag=value` is rejected (so `--dry-run=true`
 * cannot silently run the real operation) and the next word stays positional.
 */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'dry-run',
  'json',
  'read-only',
  'yes',
  'force',
  'finish',
  'restore',
  'local',
  'public',
  'purge-data',
]);

export function parseFlags(argv: string[]) {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const body = value.slice(2);
    const equals = body.indexOf('=');
    const key = equals === -1 ? body : body.slice(0, equals);
    if (BOOLEAN_FLAGS.has(key)) {
      if (equals !== -1) throw new Error(`--${key} is a switch and does not take a value. Pass --${key} on its own.`);
      flags[key] = true;
      continue;
    }
    if (equals !== -1) {
      flags[key] = body.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positionals, flags };
}

const COMMAND_FLAGS: Record<string, readonly string[]> = {
  init: ['local', 'public', 'domain', 'admin-email', 'admin-password', 'admin-password-file', 'port'],
  update: ['to', 'dry-run', 'json'],
  backup: ['keep', 'force', 'yes', 'json'],
  restore: ['yes'],
  rollback: ['yes'],
  doctor: [],
  verify: ['public', 'verification-email', 'verification-password-file', 'read-only', 'json'],
  recover: ['dry-run', 'finish', 'restore', 'yes', 'json'],
  adopt: ['from'],
  credentials: ['yes', 'owner-password', 'owner-password-file', 'admin-password', 'admin-password-file'],
  status: ['json'],
  logs: ['tail'],
  start: [],
  stop: [],
  restart: [],
  remove: ['purge-data', 'yes'],
};

/**
 * Explicit command mutation policy (R4.AC4). Read-only invocation bypasses the
 * deployment lease entirely; full verification and every other mutation keep
 * the existing single-writer lease and pending-operation gate.
 */
export function verifyIsReadOnly(flags: Flags) {
  return flags['read-only'] === true;
}

/** Reject typos before they can silently produce an unexpected deployment. */
export function assertCommandFlags(command: string, flags: Flags) {
  const allowed = new Set(['help', ...(COMMAND_FLAGS[command] ?? [])]);
  const unknown = Object.keys(flags).filter((flag) => !allowed.has(flag));
  if (unknown.length > 0) {
    throw new Error(`Unknown option${unknown.length === 1 ? '' : 's'} for ${command}: ${unknown.map((flag) => `--${flag}`).join(', ')}. Run npx @or3/cloud ${command} --help.`);
  }
}

/** Reject positional typos before any command can act on the current directory. */
export function assertCommandPositionals(command: string, positionals: string[]) {
  if (command === 'backup' || command === 'credentials') return;
  if (command === 'init' || command === 'adopt') {
    if (positionals.length > 1) throw new Error(`${command} accepts at most one target directory.`);
    return;
  }
  if (command === 'restore') {
    if (positionals.length !== 1) throw new Error('restore requires exactly one backup ID or absolute backup path.');
    return;
  }
  if (command === 'logs') {
    if (positionals.length > 1) throw new Error('logs accepts at most one service name.');
    return;
  }
  if (positionals.length > 0) {
    throw new Error(`${command} accepts no positional arguments. Run npx @or3/cloud ${command} --help.`);
  }
}

export function stringFlag(flags: Flags, key: string) {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

export function boolFlag(flags: Flags, key: string) {
  return flags[key] === true;
}

export function requireStringFlag(flags: Flags, key: string) {
  const value = stringFlag(flags, key)?.trim();
  if (!value) throw new Error(`--${key} requires a value.`);
  return value;
}
