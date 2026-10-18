import { createHmac, randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { parse } from 'dotenv';
import { writeEnvFileDetailed } from '../../../server/admin/config/env-file';
import { RestartError } from './controller';
import { restartSettingKeys } from '../../admin/configuration';

function settingValues(env: NodeJS.ProcessEnv, effective = true) {
    const mode = (effective ? env.NUXT_AUTH_REGISTRATION_MODE : undefined) ?? env.OR3_AUTH_REGISTRATION_MODE ?? (env.OR3_AUTH_AUTO_PROVISION === 'false' ? 'disabled' : 'open');
    if (!['open', 'invite_only', 'disabled'].includes(mode)) throw new RestartError('configuration_invalid');
    return { registrationMode: mode, allowRestart: ((effective ? env.NUXT_ADMIN_ALLOW_RESTART : undefined) ?? env.OR3_ADMIN_ALLOW_RESTART) === 'true' };
}
function prerequisiteFingerprint(env: NodeJS.ProcessEnv) {
    return createHash('sha256').update(JSON.stringify(Object.entries(env).filter(([key]) => !restartSettingKeys.has(key)).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
}

/** Private HMAC revisions avoid publishing hashes of low-entropy secret values. */
export async function createRestartConfigurationSource(file: string, stateDirectory: string, environment: () => Promise<NodeJS.ProcessEnv>) {
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    const keyPath = join(stateDirectory, 'revision.key');
    try { await writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const key = await readFile(keyPath);
    if (key.length !== 32) throw new RestartError('revision_key_invalid');
    const initial = prerequisiteFingerprint(await environment());
    const read = async () => {
        const text = await readFile(file, 'utf8').catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
            throw error;
        });
        const fileValues = parse(text);
        const env = await environment();
        const expected = { ...env, ...Object.fromEntries(Object.entries(fileValues).filter(([key]) => restartSettingKeys.has(key))) };
        const settings = settingValues(expected, false);
        const effective = settingValues(env);
        return {
            revision: createHmac('sha256', key).update(text).digest('hex'), settings,
            compatible: initial === prerequisiteFingerprint(env) && Object.entries(settings).every(([name, value]) => effective[name as keyof typeof effective] === value),
            text,
        };
    };
    return {
        async configuration() { const { text: _text, ...value } = await read(); return value; },
        async save(updates: Record<string, string | null>, expectedRevision: string) {
            if (Object.keys(updates).length > 8 || Object.keys(updates).some(key => !restartSettingKeys.has(key))) throw new RestartError('configuration_unsupported', 501);
            if (updates.OR3_AUTH_REGISTRATION_MODE !== undefined && updates.OR3_AUTH_REGISTRATION_MODE !== null && !['open', 'invite_only', 'disabled'].includes(updates.OR3_AUTH_REGISTRATION_MODE)) throw new RestartError('configuration_invalid', 400);
            if (updates.OR3_ADMIN_ALLOW_RESTART !== undefined && updates.OR3_ADMIN_ALLOW_RESTART !== null && !['true', 'false'].includes(updates.OR3_ADMIN_ALLOW_RESTART)) throw new RestartError('configuration_invalid', 400);
            const current = await read();
            if (current.revision !== expectedRevision) throw new RestartError('stale_revision');
            await writeEnvFileDetailed(updates, { instanceDir: dirname(file), envFile: basename(file), expectedContent: current.text });
        },
    };
}
