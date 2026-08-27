import { useRuntimeConfig } from '#imports';
import type { WorkflowMessageData } from '~/utils/chat/workflow-types';
import type { BackgroundWorkflowParams } from './background-execution';
import { decryptSecret, encryptSecret } from '../webhooks/crypto';

export interface WorkflowResumeEnvelope {
    version: 1;
    encryptedParams: string;
}

export type WorkflowStateWithResume = WorkflowMessageData & {
    serverResume?: WorkflowResumeEnvelope;
};

function resumeEncryptionKey(): string {
    const config = useRuntimeConfig();
    const adminSecret = (
        config.admin as
            | { auth?: { jwtSecret?: unknown } }
            | undefined
    )?.auth?.jwtSecret;
    const webhookKey = (
        config.webhooks as { encryptionKey?: unknown } | undefined
    )?.encryptionKey;
    const key = [adminSecret, webhookKey].find(
        (value): value is string =>
            typeof value === 'string' && value.trim().length > 0
    );
    if (!key) {
        throw new Error(
            'Durable background workflows require a stable admin JWT or webhook encryption key'
        );
    }
    return key;
}

export function createWorkflowResumeEnvelope(
    params: BackgroundWorkflowParams
): WorkflowResumeEnvelope {
    return {
        version: 1,
        encryptedParams: encryptSecret(
            JSON.stringify(params),
            resumeEncryptionKey()
        ),
    };
}

export function readWorkflowResumeEnvelope(
    state: WorkflowStateWithResume
): BackgroundWorkflowParams {
    if (state.serverResume?.version !== 1) {
        throw new Error('Background workflow has no supported resume envelope');
    }
    try {
        return JSON.parse(
            decryptSecret(
                state.serverResume.encryptedParams,
                resumeEncryptionKey()
            )
        ) as BackgroundWorkflowParams;
    } catch {
        throw new Error('Background workflow resume data could not be decrypted');
    }
}

/** Never expose server-only recovery credentials in SSE workflow snapshots. */
export function publicWorkflowState(
    state: WorkflowMessageData | undefined
): WorkflowMessageData | undefined {
    if (!state) return undefined;
    const { serverResume: _serverResume, ...publicState } =
        state as WorkflowStateWithResume;
    return publicState;
}
