import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { valid } from 'semver';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';

function pinPath(pluginId: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(pluginId)) throw new Error('Invalid plugin id');
    return join(EXTENSIONS_BASE_DIR, '.update-pins', `${pluginId}.json`);
}

export async function readUpdatePin(pluginId: string): Promise<string | null> {
    try {
        const value: unknown = JSON.parse(await fs.readFile(pinPath(pluginId), 'utf8'));
        if (typeof value !== 'string' || !valid(value)) throw new Error('Invalid update pin');
        return value;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

export async function writeUpdatePin(pluginId: string, version: string | null): Promise<void> {
    const path = pinPath(pluginId);
    if (version === null) {
        await fs.rm(path, { force: true });
        return;
    }
    if (!valid(version)) throw new Error('Invalid pinned version');
    await fs.mkdir(join(EXTENSIONS_BASE_DIR, '.update-pins'), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, JSON.stringify(version), { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, path);
    } finally {
        await fs.rm(temporary, { force: true });
    }
}
