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
 * - Operates synchronously on the `.env` file located in `process.cwd()`.
 * - Limited to basic `KEY=VALUE` pair parsing; does not support complex shell features.
 *
 * Non-goals:
 * - Does not handle configuration validation or defaults.
 * - Does not perform masking of sensitive values (handled at manager level).
 */
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

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

const ENV_PATH = resolve(process.cwd(), '.env');

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
    if (/[\s#]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
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
export async function readEnvFile(): Promise<{ lines: EnvLine[]; map: Record<string, string> }> {
    let content = '';
    try {
        content = await fs.readFile(ENV_PATH, 'utf8');
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
    const map: Record<string, string> = {};
    for (const line of lines) {
        if (line.type === 'entry') {
            map[line.key] = line.value;
        }
    }
    return { lines, map };
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
export async function writeEnvFile(
    updates: Record<string, string | null>
): Promise<void> {
    const { lines, map } = await readEnvFile();
    const updatedMap = { ...map };
    for (const [key, value] of Object.entries(updates)) {
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
            const nextValue = updatedMap[line.key];
            seen.add(line.key);
            if (nextValue === undefined) return '';
            return `${line.key}=${formatValue(nextValue)}`;
        })
        .filter((line) => line !== '');

    const newKeys = Object.keys(updatedMap).filter((key) => !seen.has(key));
    for (const key of newKeys) {
        nextLines.push(`${key}=${formatValue(updatedMap[key] ?? '')}`);
    }

    await fs.writeFile(ENV_PATH, nextLines.join('\n'), 'utf8');
}
