import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

export type EnvLine =
    | { type: 'comment'; raw: string }
    | { type: 'blank'; raw: string }
    | { type: 'entry'; key: string; value: string; raw: string };

const ENV_PATH = resolve(process.cwd(), '.env');

function parseLine(line: string): EnvLine {
    const trimmed = line.trim();
    if (trimmed.length === 0) return { type: 'blank', raw: line };
    if (trimmed.startsWith('#')) return { type: 'comment', raw: line };

    const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(line);
    if (!match) return { type: 'comment', raw: line };
    return { type: 'entry', key: match[1]!, value: match[2] ?? '', raw: line };
}

function formatValue(value: string): string {
    if (value === '') return '';
    if (/[\s#]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
    return value;
}

export async function readEnvFile(): Promise<{ lines: EnvLine[]; map: Record<string, string> }> {
    let content = '';
    try {
        content = await fs.readFile(ENV_PATH, 'utf8');
    } catch {
        content = '';
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
