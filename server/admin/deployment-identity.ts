/**
 * Durable deployment identity.
 *
 * A container replacement must not change how stored credentials are bound:
 * hostnames are ephemeral in managed deployments (no stable hostname and no
 * OR3_INSTANCE_ID), so deriving an authenticated-encryption context from the
 * hostname would make every restart invalidate stored secrets even though the
 * data volume and encryption key survive. The identity is generated once and
 * persisted next to the other admin state, so it survives restarts, updates and
 * restores of the same data directory.
 */
import { randomBytes } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveAdminDataDir } from './auth/data-paths';

const FILE_NAME = 'deployment-identity';
const ID_PATTERN = /^or3dep_[a-f0-9]{32}$/;

export interface DeploymentIdentityOptions {
    readonly directory?: string;
}

/**
 * Reads the persisted identity, creating it once. The final name is published
 * with `link`, which is atomic create-if-absent: when two starters race, one
 * wins and the other reads the winner's value instead of a divergent identity.
 */
export async function resolveDeploymentIdentity(
    options: DeploymentIdentityOptions = {}
): Promise<string> {
    const directory = options.directory ?? resolveAdminDataDir();
    const path = join(directory, FILE_NAME);
    const existing = await readIdentity(path);
    if (existing) return existing;

    await mkdir(directory, { recursive: true, mode: 0o700 });
    const generated = `or3dep_${randomBytes(16).toString('hex')}`;
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temporary, `${generated}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
        await link(temporary, path);
        await rm(temporary, { force: true });
        return generated;
    } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
            const raced = await readIdentity(path);
            if (raced) return raced;
        }
        if (code === 'EPERM' || code === 'ENOSYS' || code === 'EXDEV') {
            // Filesystems without hard links still get create-if-absent.
            try {
                await writeFile(path, `${generated}\n`, {
                    encoding: 'utf8',
                    mode: 0o600,
                    flag: 'wx',
                });
                return generated;
            } catch (writeError) {
                if ((writeError as NodeJS.ErrnoException).code === 'EEXIST') {
                    const raced = await readIdentity(path);
                    if (raced) return raced;
                }
                throw writeError;
            }
        }
        throw error;
    }
}

async function readIdentity(path: string): Promise<string | null> {
    let raw: string;
    try {
        raw = await readFile(path, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
    const value = raw.trim();
    if (!ID_PATTERN.test(value)) {
        throw new Error('The persisted deployment identity is not in the expected format');
    }
    return value;
}

let cached: Promise<string> | null = null;

/** Process-wide identity, resolved once. */
export function deploymentIdentity(): Promise<string> {
    cached ??= resolveDeploymentIdentity();
    return cached;
}

export function _resetDeploymentIdentityForTest(): void {
    cached = null;
}
