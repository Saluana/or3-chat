export const BACKGROUND_HISTORY_CONTRACT_VERSION = 1 as const;

export type CanonicalHistoryActor = {
    userId: string;
    workspaceId: string;
};

export type CanonicalHistoryRecord = Record<string, unknown> & {
    id: string;
    clock: number;
    hlc?: string;
};

export type ChatGenerationAdmissionEnvelope = {
    version: typeof BACKGROUND_HISTORY_CONTRACT_VERSION;
    kind: 'new-turn' | 'continuation';
    admissionId: string;
    generationId: string;
    workspaceId: string;
    threadId: string;
    messageId: string;
    thread?: CanonicalHistoryRecord;
    userMessage?: CanonicalHistoryRecord;
    assistantMessage: CanonicalHistoryRecord;
    expectedAssistant?: {
        clock: number;
        generationId?: string;
    };
};

export type CanonicalGenerationSnapshot = {
    status: 'complete' | 'error' | 'aborted';
    content: string;
    reasoning: string;
    toolCalls?: unknown[];
    error?: string;
    completedAt: number;
};

export type AdmitChatGenerationResult = {
    status: 'admitted';
    replayed: boolean;
    serverVersion: number;
};

export type FinalizeChatGenerationResult =
    | {
          status: 'committed';
          replayed: boolean;
          serverVersion: number;
      }
    | {
          status: 'superseded';
          reason: 'deleted' | 'newer_generation' | 'edited' | 'missing';
      };

export function backgroundHistoryDeviceId(generationId: string): string {
    return `background:${generationId}`;
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function historyRecord(value: unknown, label: string): CanonicalHistoryRecord {
    const candidate = record(value);
    if (
        !candidate ||
        typeof candidate.id !== 'string' ||
        !candidate.id ||
        typeof candidate.clock !== 'number' ||
        !Number.isSafeInteger(candidate.clock) ||
        candidate.clock < 0
    ) {
        throw new Error(`Invalid background history ${label}`);
    }
    return candidate as CanonicalHistoryRecord;
}

/** Parse the untrusted client envelope before it enters durable job storage. */
export function parseChatGenerationAdmissionEnvelope(
    value: unknown
): ChatGenerationAdmissionEnvelope {
    const candidate = record(value);
    if (!candidate || candidate.version !== BACKGROUND_HISTORY_CONTRACT_VERSION) {
        throw new Error('Invalid background history contract version');
    }
    if (candidate.kind !== 'new-turn' && candidate.kind !== 'continuation') {
        throw new Error('Invalid background history kind');
    }
    for (const key of ['admissionId', 'generationId', 'workspaceId', 'threadId', 'messageId'] as const) {
        if (typeof candidate[key] !== 'string' || !candidate[key]) {
            throw new Error(`Invalid background history ${key}`);
        }
    }
    const assistantMessage = historyRecord(candidate.assistantMessage, 'assistant message');
    if (
        assistantMessage.id !== candidate.messageId ||
        assistantMessage.thread_id !== candidate.threadId ||
        assistantMessage.role !== 'assistant'
    ) {
        throw new Error('Background history assistant identity mismatch');
    }
    const thread = candidate.thread ? historyRecord(candidate.thread, 'thread') : undefined;
    if (thread && thread.id !== candidate.threadId) {
        throw new Error('Background history thread identity mismatch');
    }
    const userMessage = candidate.userMessage
        ? historyRecord(candidate.userMessage, 'user message')
        : undefined;
    if (userMessage && (userMessage.thread_id !== candidate.threadId || userMessage.role !== 'user')) {
        throw new Error('Background history user identity mismatch');
    }
    const expected = record(candidate.expectedAssistant);
    if (
        expected &&
        (typeof expected.clock !== 'number' ||
            !Number.isSafeInteger(expected.clock) ||
            expected.clock < 0)
    ) {
        throw new Error('Invalid expected assistant clock');
    }
    const expectedAssistant = expected
        ? {
              clock: expected.clock as number,
              ...(typeof expected.generationId === 'string'
                  ? { generationId: expected.generationId }
                  : {}),
          }
        : undefined;
    if (candidate.kind === 'new-turn' && (!thread || !userMessage)) {
        throw new Error('New-turn background history requires thread and user records');
    }
    if (candidate.kind === 'continuation' && !expectedAssistant) {
        throw new Error('Continuation background history requires an expected assistant');
    }
    if (
        candidate.kind === 'continuation' &&
        expectedAssistant &&
        assistantMessage.clock <= expectedAssistant.clock
    ) {
        throw new Error('Continuation background history must advance the assistant clock');
    }
    return {
        version: BACKGROUND_HISTORY_CONTRACT_VERSION,
        kind: candidate.kind,
        admissionId: candidate.admissionId as string,
        generationId: candidate.generationId as string,
        workspaceId: candidate.workspaceId as string,
        threadId: candidate.threadId as string,
        messageId: candidate.messageId as string,
        thread,
        userMessage,
        assistantMessage,
        expectedAssistant,
    };
}
