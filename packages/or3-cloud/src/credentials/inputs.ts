import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { type Flags, stringFlag } from '../cli/args';
import { readText } from '../util/fs';
import { randomPassword } from '../util/primitives';

export function validatePassword(password: string) {
  if (password.includes('\0') || /\r|\n/.test(password)) {
    throw new Error('The administrator password may not contain NUL or newline characters.');
  }
  if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('The administrator password must be at least 12 characters and contain uppercase, lowercase, and numeric characters.');
  }
}

export function validateEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Use a real administrator email address, for example admin@example.com.');
  }
}

export async function resolveAdminEmail(flags: Flags) {
  const supplied = stringFlag(flags, 'admin-email')?.trim();
  if (supplied) {
    validateEmail(supplied);
    return supplied;
  }
  if (!input.isTTY || !output.isTTY) {
    throw new Error('--admin-email is required in a non-interactive session so the first administrator identity is not a placeholder.');
  }
  const prompt = readline.createInterface({ input, output });
  try {
    const answer = (await prompt.question('Administrator email: ')).trim();
    validateEmail(answer);
    return answer;
  } finally {
    prompt.close();
  }
}

export async function readPassword(flags: Flags) {
  const passwordFlagValue = flags['admin-password'];
  const passwordFileValue = flags['admin-password-file'];
  if (passwordFlagValue !== undefined && typeof passwordFlagValue !== 'string') {
    throw new Error('--admin-password requires a value.');
  }
  if (passwordFileValue !== undefined && typeof passwordFileValue !== 'string') {
    throw new Error('--admin-password-file requires a path.');
  }
  const passwordFlag = passwordFlagValue as string | undefined;
  const passwordFile = passwordFileValue as string | undefined;
  if (passwordFileValue !== undefined && !passwordFile) {
    throw new Error('--admin-password-file requires a path.');
  }
  if (passwordFlag !== undefined && passwordFile !== undefined) {
    throw new Error('Use either --admin-password or --admin-password-file, not both.');
  }
  if (passwordFlag !== undefined) {
    validatePassword(passwordFlag);
    return passwordFlag;
  }
  if (passwordFile) {
    const value = (await readText(resolve(passwordFile))).trim();
    if (!value) throw new Error('The administrator password file is empty.');
    validatePassword(value);
    return value;
  }
  const password = randomPassword();
  validatePassword(password);
  return password;
}

/**
 * Resolves the two new passwords for `credentials reset`: both flags together,
 * or interactive prompts. Credentials are never generated or printed here;
 * the passwords go only into protected state files and the container reset.
 */
export async function resolveResetPasswords(flags: Flags) {
  const ownerPassword = stringFlag(flags, 'owner-password');
  const ownerPasswordFile = stringFlag(flags, 'owner-password-file');
  const adminPassword = stringFlag(flags, 'admin-password');
  const adminPasswordFile = stringFlag(flags, 'admin-password-file');
  if (flags['owner-password'] !== undefined && ownerPassword === undefined) throw new Error('--owner-password requires a value.');
  if (flags['admin-password'] !== undefined && adminPassword === undefined) throw new Error('--admin-password requires a value.');
  if (flags['owner-password-file'] !== undefined && !ownerPasswordFile) throw new Error('--owner-password-file requires a path.');
  if (flags['admin-password-file'] !== undefined && !adminPasswordFile) throw new Error('--admin-password-file requires a path.');
  if (ownerPassword !== undefined && ownerPasswordFile) throw new Error('Use either --owner-password or --owner-password-file, not both.');
  if (adminPassword !== undefined && adminPasswordFile) throw new Error('Use either --admin-password or --admin-password-file, not both.');
  const suppliedOwner = ownerPassword ?? (ownerPasswordFile ? (await readText(resolve(ownerPasswordFile))).trim() : undefined);
  const suppliedAdmin = adminPassword ?? (adminPasswordFile ? (await readText(resolve(adminPasswordFile))).trim() : undefined);
  if (suppliedOwner !== undefined || suppliedAdmin !== undefined) {
    if (suppliedOwner === undefined || suppliedAdmin === undefined) {
      throw new Error('Supply both owner and admin passwords so a reset never applies one credential without the other.');
    }
    validatePassword(suppliedOwner);
    validatePassword(suppliedAdmin);
    return { ownerPassword: suppliedOwner, adminPassword: suppliedAdmin };
  }
  if (!input.isTTY || !output.isTTY) {
    throw new Error('--owner-password-file and --admin-password-file are required in a non-interactive session. Credentials are never generated automatically.');
  }
  const owner = (await maskedQuestion('New owner (basic auth) password: ')).trim();
  validatePassword(owner);
  const admin = (await maskedQuestion('New admin password: ')).trim();
  validatePassword(admin);
  return { ownerPassword: owner, adminPassword: admin };
}

async function maskedQuestion(question: string) {
  let muted = false;
  const maskedOutput = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) output.write(chunk);
      callback();
    },
  });
  const prompt = readline.createInterface({ input, output: maskedOutput, terminal: true });
  try {
    const answer = prompt.question(question);
    muted = true;
    return await answer;
  } finally {
    prompt.close();
    output.write('\n');
  }
}
