import { nextTick, type Ref } from 'vue';

export interface SyncHarnessTestCase {
    id: string;
    name: string;
    description: string;
    category: string;
    status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
    duration?: number;
    error?: string;
    fn: () => Promise<void>;
}

export interface SyncHarnessLogEntry {
    time: string;
    level: 'info' | 'success' | 'error' | 'warn' | 'debug';
    message: string;
}

export function createSyncHarnessLogger(
    logs: Ref<SyncHarnessLogEntry[]>,
    logContainer: Ref<HTMLElement | null>
) {
    function log(level: SyncHarnessLogEntry['level'], message: string) {
        const now = new Date();
        const time =
            now.toLocaleTimeString('en-US', { hour12: false }) +
            '.' +
            String(now.getMilliseconds()).padStart(3, '0');
        logs.value.push({ time, level, message });

        nextTick(() => {
            if (logContainer.value) {
                logContainer.value.scrollTop = logContainer.value.scrollHeight;
            }
        });

        const consoleFn =
            level === 'error'
                ? console.error
                : level === 'warn'
                  ? console.warn
                  : console.log;
        consoleFn(`[SyncHarness] [${level.toUpperCase()}] ${message}`);
    }

    return {
        log,
        clearLogs: () => {
            logs.value = [];
        },
    };
}

export async function runSyncHarnessTest(
    test: SyncHarnessTestCase,
    log: (level: SyncHarnessLogEntry['level'], message: string) => void,
    refreshSyncHealth: () => Promise<void>
) {
    test.status = 'running';
    test.error = undefined;
    test.duration = undefined;

    log('info', `Running test: ${test.name}`);
    const start = Date.now();

    try {
        await test.fn();
        test.status = 'passed';
        test.duration = Date.now() - start;
        log('success', `✓ ${test.name} (${test.duration}ms)`);
    } catch (error) {
        test.status = 'failed';
        test.duration = Date.now() - start;
        test.error = error instanceof Error ? error.message : String(error);
        log('error', `✗ ${test.name}: ${test.error}`);
    }

    await refreshSyncHealth();
}
