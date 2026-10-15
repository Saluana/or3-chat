/**
 * @module shared/cloud/wizard/store
 *
 * Purpose:
 * Disk-backed persistence for wizard sessions and user-defined presets.
 * Sessions are stored as individual JSON files; presets are stored in
 * a single JSON array file.
 *
 * Storage layout:
 * ```
 * ~/.or3-cloud/
 *   sessions/
 *     {uuid}.json      # One file per session
 *   presets.json        # All user presets
 *   last-session.txt    # ID of most recently saved session
 * ```
 *
 * Constraints:
 * - The base directory can be overridden via `OR3_CLOUD_WIZARD_HOME` env var.
 * - Sessions contain only non-secret answers by default; secrets are held
 *   in the transient in-memory store managed by `api.ts`.
 * - Preset file corruption (invalid JSON) is handled gracefully by
 *   returning an empty array.
 * - Preset mutations share a cross-process filesystem lease.
 *
 * Non-responsibilities:
 * - Secret management (see api.ts transient store)
 * - Preset validation (see validation.ts)
 *
 * @see Or3CloudWizardApi for session lifecycle that wraps these primitives
 */
import { mkdir, readFile, rm, open, rename, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AdvisoryPluginOperationLock } from '../../../server/admin/plugins/package-operation-lock';
import { dirname, resolve } from 'node:path';
import type { WizardPreset, WizardSession } from './types';

function wizardBaseDir(): string {
    return resolve(process.env.OR3_CLOUD_WIZARD_HOME ?? homedir(), '.or3-cloud');
}

function sessionsDir(): string {
    return resolve(wizardBaseDir(), 'sessions');
}

function presetsFilePath(): string {
    return resolve(wizardBaseDir(), 'presets.json');
}

function lastSessionPath(): string {
    return resolve(wizardBaseDir(), 'last-session.txt');
}

function sessionPath(sessionId: string): string {
    return resolve(sessionsDir(), `${sessionId}.json`);
}

async function ensureWizardDir(): Promise<void> {
    await mkdir(wizardBaseDir(), { recursive: true, mode: 0o700 });
    await chmod(wizardBaseDir(), 0o700);
}

async function ensureSessionsDir(): Promise<void> {
    await ensureWizardDir();
    await mkdir(sessionsDir(), { recursive: true, mode: 0o700 });
    await chmod(sessionsDir(), 0o700);
}

async function atomicPrivateWrite(path: string, content: string): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(content, 'utf8'); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, path);
        if (process.platform !== 'win32') {
            const directory = await open(dirname(path), 'r');
            try { await directory.sync(); } finally { await directory.close(); }
        }
    } finally { await rm(temporary, { force: true }); }
}

async function withPresetLock(action: () => Promise<void>): Promise<void> {
    await ensureWizardDir();
    const lease = await new AdvisoryPluginOperationLock(wizardBaseDir()).acquire('presets', { requireDeadOwner: true });
    try { await action(); } finally { await lease.release(); }
}

/** Writes a session to disk and updates the last-session pointer. */
export async function saveSession(session: WizardSession): Promise<void> {
    await ensureSessionsDir();
    await atomicPrivateWrite(sessionPath(session.id), JSON.stringify(session, null, 2));
    await atomicPrivateWrite(lastSessionPath(), session.id);
}

/**
 * Reads a session from disk by ID.
 *
 * @throws Error when the session file does not exist or contains invalid JSON.
 */
export async function readSession(sessionId: string): Promise<WizardSession> {
    const file = sessionPath(sessionId);
    const content = await readFile(file, 'utf8');
    return JSON.parse(content) as WizardSession;
}

/** Deletes a session file from disk. No-op if the file does not exist. */
export async function deleteSession(sessionId: string): Promise<void> {
    const file = sessionPath(sessionId);
    if (!existsSync(file)) return;
    await rm(file, { force: true });
}

/**
 * Returns the ID of the most recently saved session, or `null` if
 * no sessions have been saved or the pointer file is missing.
 */
export async function readLastSessionId(): Promise<string | null> {
    const file = lastSessionPath();
    if (!existsSync(file)) return null;
    try {
        const value = await readFile(file, 'utf8');
        return value.trim() || null;
    } catch {
        return null;
    }
}

async function readPresetsFile(): Promise<WizardPreset[]> {
    const file = presetsFilePath();
    if (!existsSync(file)) return [];
    try {
        const content = await readFile(file, 'utf8');
        const parsed = JSON.parse(content) as WizardPreset[];
        if (!Array.isArray(parsed)) return [];
        return parsed;
    } catch {
        return [];
    }
}

async function writePresetsFile(presets: WizardPreset[]): Promise<void> {
    await ensureWizardDir();
    await atomicPrivateWrite(presetsFilePath(), JSON.stringify(presets, null, 2));
}

/** Returns all user-defined presets from disk (excludes built-in presets). */
export async function listStoredPresets(): Promise<WizardPreset[]> {
    return readPresetsFile();
}

/**
 * Saves a preset to disk. If a preset with the same name already exists,
 * it is replaced. The presets file is kept sorted by name.
 */
export async function saveStoredPreset(preset: WizardPreset): Promise<void> {
    await withPresetLock(async () => {
        const presets = await readPresetsFile();
        const filtered = presets.filter((entry) => entry.name !== preset.name);
        filtered.push(preset);
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        await writePresetsFile(filtered);
    });
}

/** Loads a single user preset by name, or returns `null` if not found. */
export async function loadStoredPreset(name: string): Promise<WizardPreset | null> {
    const presets = await readPresetsFile();
    return presets.find((preset) => preset.name === name) ?? null;
}

/** Removes a preset from disk by name. No-op if the preset does not exist. */
export async function deleteStoredPreset(name: string): Promise<void> {
    await withPresetLock(async () => {
        const presets = await readPresetsFile();
        const filtered = presets.filter((preset) => preset.name !== name);
        await writePresetsFile(filtered);
    });
}
