/**
 * @module server/admin/config/env-file.ts
 *
 * Purpose:
 * Provides low-level file system access for reading and updating the project's
 * `.env` file. It ensures that manual edits (comments, spacing) are preserved
 * as much as possible during automated updates.
 *
 * Responsibilities:
 * - Parsing raw `.env` lines into structured objects.
 * - Safely formatting values for shell/env compatibility (quoting, escaping).
 * - Synchronizing updates to disk while maintaining file structure.
 *
 * Constraints:
 * - Uses the authoritative instance/env path supplied by its controller.
 * - Limited to basic `KEY=VALUE` pair parsing; does not support complex shell features.
 *
 * Non-goals:
 * - Does not handle configuration validation or defaults.
 * - Does not perform masking of sensitive values (handled at manager level).
 */
import { promises as fs } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';

/**
 * Represents a single line in an .env file.
 *
 * Purpose:
 * Allows the parser to maintain the original file's formatting by distinguishing
 * between actual configuration data and structural elements like comments.
 */
export type EnvLine =
    /** A comment line beginning with # */
    | { type: 'comment'; raw: string }
    /** An empty or whitespace-only line */
    | { type: 'blank'; raw: string }
    /** A key-value pair entry (e.g., KEY=VALUE) */
    | { type: 'entry'; key: string; value: string; raw: string };

export type EnvFileLocation = {
    instanceDir?: string;
    envFile?: string;
};

export type EnvWriteOptions = EnvFileLocation & {
    /** Compare under the writer lock; stale editors must reread before saving. */
    expectedContent?: string;
    /**
     * When true, creates a timestamped backup before writing if target exists.
     * Backup files use `<envFile>.backup.<timestamp>`.
     */
    createBackup?: boolean;
};

export type EnvWriteResult = {
    path: string;
    backupPath: string | null;
    changed: boolean;
};

function resolveEnvPath(location: EnvFileLocation = {}): string {
    return resolve(location.instanceDir ?? process.cwd(), location.envFile ?? '.env');
}

/**
 * Parses a single line from an .env file into an EnvLine object.
 *
 * Behavior:
 * Uses a strict regex to identify assignments. If a line does not match the
 * expected `KEY=VALUE` format, it is treated as a comment to prevent data loss
 * during round-trip writes.
 */
function parseLine(line: string): EnvLine {
    const trimmed = line.trim();
    if (trimmed.length === 0) return { type: 'blank', raw: line };
    if (trimmed.startsWith('#')) return { type: 'comment', raw: line };

    const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(line);
    if (!match) return { type: 'comment', raw: line };
    return { type: 'entry', key: match[1]!, value: match[2] ?? '', raw: line };
}

/**
 * Formats an environment variable value for safe storage in an .env file.
 *
 * Behavior:
 * Wraps values in double quotes if they contain spaces or hash characters.
 * Escapes internal double quotes to maintain parser compatibility.
 */
function formatValue(value: string): string {
    if (value === '') return '';
    if (/[\s#"'\\]/.test(value)) return JSON.stringify(value);
    return value;
}

/**
 * Reads and parses the .env file from the project root.
 *
 * Behavior:
 * 1. Attempts to read `.env`.
 * 2. If missing, returns an empty structure (does not throw).
 * 3. Splits by line and parses each into an `EnvLine`.
 * 4. Aggregates entries into a key-value map for fast lookup.
 */
export async function readEnvFile(
    location: EnvFileLocation = {}
): Promise<{ lines: EnvLine[]; map: Record<string, string>; path: string }> {
    const envPath = resolveEnvPath(location);
    let content = '';
    try {
        content = await fs.readFile(envPath, 'utf8');
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
            content = '';
        } else {
            throw error;
        }
    }
    const rawLines = content.split(/\r?\n/);
    const lines = rawLines.map(parseLine);
    const map: Record<string, string> = parse(content);
    return { lines, map, path: envPath };
}

/**
 * Synthesizes updates into the .env file.
 *
 * Behavior:
 * - Updates existing keys in place, preserving their original line position.
 * - Appends new keys to the end of the file.
 * - Deletes keys when their value is explicitly `null`.
 * - Preserves all comments and blank lines.
 *
 * @example
 * ```ts
 * await writeEnvFile({
 *   'OR3_SITE_NAME': 'My Custom Chat',
 *   'OLD_UNUSED_KEY': null
 * });
 * ```
 */
function formatTimestamp(value: Date): string {
    const year = String(value.getFullYear());
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    const hour = String(value.getHours()).padStart(2, '0');
    const minute = String(value.getMinutes()).padStart(2, '0');
    const second = String(value.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}-${hour}${minute}${second}`;
}

async function createBackupIfNeeded(
    path: string,
    createBackup: boolean | undefined
): Promise<string | null> {
    if (!createBackup) return null;
    try {
        await fs.access(path);
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') return null;
        throw error;
    }

    const stamp = formatTimestamp(new Date());
    const backupPath = resolve(dirname(path), `${basename(path)}.backup.${stamp}`);
    await fs.copyFile(path, backupPath);
    await fs.chmod(backupPath, 0o600);
    return backupPath;
}

async function writeLockedEnvFile(
    updates: Record<string, string | null>,
    options: EnvWriteOptions = {}
): Promise<EnvWriteResult> {
    const path = resolveEnvPath(options);
    const original = await fs.readFile(path, 'utf8').catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw error;
    });
    if (options.expectedContent !== undefined && original !== options.expectedContent) throw new Error('revision_conflict');
    const lines = original.split(/\r?\n/).map(parseLine);
    const map = parse(original);
    const updatedMap = { ...map };
    for (const [key, value] of Object.entries(updates)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid environment key');
        if (value === null) {
            delete updatedMap[key];
        } else {
            updatedMap[key] = value;
        }
    }

    const seen = new Set<string>();
    const nextLines = lines
        .map((line) => {
            if (line.type !== 'entry') return line.raw;
            seen.add(line.key);
            if (!Object.hasOwn(updates, line.key) || updates[line.key] === map[line.key]) return line.raw;
            const nextValue = updatedMap[line.key];
            if (nextValue === undefined) return null;
            return `${line.key}=${formatValue(nextValue)}`;
        })
        .filter((line): line is string => line !== null);

    const newKeys = Object.keys(updatedMap).filter((key) => !seen.has(key));
    const trailingNewline = nextLines.at(-1) === '';
    if (newKeys.length && trailingNewline) nextLines.pop();
    for (const key of newKeys) {
        nextLines.push(`${key}=${formatValue(updatedMap[key] ?? '')}`);
    }
    if (newKeys.length && trailingNewline) nextLines.push('');

    const nextContent = nextLines.join(original.includes('\r\n') ? '\r\n' : '\n');
    const previousContent = original;
    const changed = nextContent !== previousContent;

    if (!changed) {
        try {
            await fs.chmod(path, 0o600);
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') throw error;
        }
        return {
            path,
            backupPath: null,
            changed: false,
        };
    }

    const backupPath = await createBackupIfNeeded(path, options.createBackup);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        const file = await fs.open(temporary, 'wx', 0o600);
        try { await file.writeFile(nextContent); await file.sync(); } finally { await file.close(); }
        const current = await fs.readFile(path, 'utf8').catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
            throw error;
        });
        if (current !== original) throw new Error('revision_conflict');
        await fs.rename(temporary, path);
        const directory = await fs.open(dirname(path), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
    } finally { await fs.rm(temporary, { force: true }); }
    return {
        path,
        backupPath,
        changed: true,
    };
}

export async function writeEnvFileDetailed(updates: Record<string, string | null>, options: EnvWriteOptions = {}): Promise<EnvWriteResult> {
    const lock = `${resolveEnvPath(options)}.or3-write-lock`;
    const deadline = performance.now() + 5_000;
    for (;;) {
        try { await fs.mkdir(lock, { mode: 0o700 }); break; }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            if (performance.now() >= deadline) throw new Error('configuration_writer_busy');
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
    try { return await writeLockedEnvFile(updates, options); }
    finally { await fs.rmdir(lock); }
}

export async function writeEnvFile(
    updates: Record<string, string | null>,
    options: EnvFileLocation = {}
): Promise<void> {
    await writeEnvFileDetailed(updates, options);
}
