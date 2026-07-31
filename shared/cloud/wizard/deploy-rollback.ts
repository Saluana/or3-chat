import { readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getProviderModuleFilePath } from './apply';
import { deriveLocalDevConvexEnvLocalUpdates } from './derive';
import type { WizardAnswers } from './types';

export interface WizardFileSnapshot {
    path: string;
    existed: boolean;
    content: string;
}

async function captureFileSnapshot(path: string): Promise<WizardFileSnapshot> {
    try {
        return {
            path,
            existed: true,
            content: await readFile(path, 'utf8'),
        };
    } catch (error) {
        const fsError = error as NodeJS.ErrnoException;
        if (fsError.code === 'ENOENT') {
            return {
                path,
                existed: false,
                content: '',
            };
        }
        throw error;
    }
}

export async function captureWizardRollbackSnapshots(
    answers: WizardAnswers
): Promise<WizardFileSnapshot[]> {
    const paths = new Set<string>([
        resolve(answers.instanceDir, answers.envFile),
        getProviderModuleFilePath(answers.instanceDir),
    ]);

    if (
        answers.envFile !== '.env.local' &&
        Object.keys(deriveLocalDevConvexEnvLocalUpdates(answers)).length > 0
    ) {
        paths.add(resolve(answers.instanceDir, '.env.local'));
    }

    return await Promise.all(Array.from(paths).map(captureFileSnapshot));
}

export async function restoreWizardRollbackSnapshots(
    snapshots: readonly WizardFileSnapshot[]
): Promise<void> {
    for (const snapshot of snapshots) {
        if (snapshot.existed) {
            await writeFile(snapshot.path, snapshot.content, 'utf8');
            continue;
        }

        try {
            await unlink(snapshot.path);
        } catch (error) {
            const fsError = error as NodeJS.ErrnoException;
            if (fsError.code !== 'ENOENT') {
                throw error;
            }
        }
    }
}
