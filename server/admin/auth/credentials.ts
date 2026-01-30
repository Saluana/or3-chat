/**
 * Admin credentials file management.
 * Stores hashed admin credentials at .data/admin-credentials.json
 * with atomic writes and restricted permissions (0600).
 */
import { readFile, writeFile, mkdir, access, chmod } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';

const DATA_DIR = '.data';
const CREDENTIALS_FILE = join(DATA_DIR, 'admin-credentials.json');

export type AdminCredentialsFile = {
    username: string;
    password_hash_bcrypt: string;
    created_at: string; // ISO
    updated_at: string; // ISO
};

/**
 * Ensure the .data directory exists with restricted permissions.
 */
async function ensureDataDir(): Promise<void> {
    try {
        await mkdir(DATA_DIR, { mode: 0o700, recursive: true });
    } catch (err: any) {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    }
}

/**
 * Check if credentials file exists.
 */
export async function credentialsFileExists(): Promise<boolean> {
    try {
        await access(CREDENTIALS_FILE, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Read the admin credentials from the file.
 * Returns null if the file doesn't exist.
 */
export async function readAdminCredentials(): Promise<AdminCredentialsFile | null> {
    try {
        const content = await readFile(CREDENTIALS_FILE, 'utf-8');
        return JSON.parse(content) as AdminCredentialsFile;
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            return null; // File doesn't exist - expected
        }
        throw err; // Re-throw unexpected errors
    }
}

/**
 * Write admin credentials to the file atomically.
 * Uses a temp file + rename pattern for atomicity.
 * Sets file permissions to 0600 (readable only by owner).
 */
export async function writeAdminCredentials(
    credentials: AdminCredentialsFile
): Promise<void> {
    await ensureDataDir();

    const tempFile = `${CREDENTIALS_FILE}.tmp`;
    const content = JSON.stringify(credentials, null, 2);

    // Write to temp file with restricted permissions
    await writeFile(tempFile, content, { mode: 0o600 });

    // Atomic rename
    // Note: In Node.js, fs.rename is atomic on most platforms
    const { rename } = await import('fs/promises');
    await rename(tempFile, CREDENTIALS_FILE);

    // Ensure correct permissions on the final file
    await chmod(CREDENTIALS_FILE, 0o600);
}

/**
 * Bootstrap admin credentials from environment variables.
 * Only runs if credentials file doesn't exist.
 * Returns true if bootstrapped, false if file already exists.
 */
export async function bootstrapAdminCredentialsFromEnv(
    username: string,
    password: string
): Promise<boolean> {
    const exists = await credentialsFileExists();
    if (exists) {
        return false; // Already bootstrapped
    }

    const now = new Date().toISOString();
    const { hashPassword } = await import('./hash');

    const credentials: AdminCredentialsFile = {
        username,
        password_hash_bcrypt: await hashPassword(password),
        created_at: now,
        updated_at: now,
    };

    await writeAdminCredentials(credentials);
    return true;
}

/**
 * Update admin credentials (for password change).
 * Requires the credentials file to already exist.
 */
export async function updateAdminCredentials(
    updates: Partial<Pick<AdminCredentialsFile, 'username' | 'password_hash_bcrypt'>>
): Promise<void> {
    const existing = await readAdminCredentials();
    if (!existing) {
        throw new Error('Admin credentials not initialized');
    }

    const updated: AdminCredentialsFile = {
        ...existing,
        ...updates,
        updated_at: new Date().toISOString(),
    };

    await writeAdminCredentials(updated);
}
