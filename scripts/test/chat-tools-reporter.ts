import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Runs in Playwright's coordinator, so worker replacement cannot lose attempts. */
export default class ChatToolsReporter implements Reporter {
    private readonly cases: Record<string, unknown>[] = [];
    private suite?: Suite;
    private readonly receiptPath: string;
    private readonly command: string;
    private readonly commit: string;
    private readonly dirty: boolean;

    constructor(options: { receiptPath?: string; command?: string; commit?: string; dirty?: boolean } = {}) {
        this.receiptPath = options.receiptPath ?? 'test-results/chat-tools/receipt.json';
        this.command = options.command ?? 'bun run test:e2e:chat-tools';
        this.commit = options.commit ?? process.env.OR3_CHAT_TOOLS_SOURCE_COMMIT ?? 'unknown';
        this.dirty = options.dirty ?? process.env.OR3_CHAT_TOOLS_SOURCE_DIRTY === 'true';
    }
    onBegin(_config: FullConfig, suite: Suite) { this.suite = suite; }
    onTestEnd(test: TestCase, result: TestResult) {
        const attachment = result.attachments.find(item => item.name === 'chat-tools-evidence');
        const evidence = attachment ? JSON.parse(attachment.body?.toString('utf8')
            ?? (attachment.path ? readFileSync(attachment.path, 'utf8') : '{}')) : {};
        this.cases.push({ case: test.title, testId: test.id, project: test.parent.project()?.name,
            status: result.status, retry: result.retry, workerIndex: result.workerIndex, durationMs: result.duration,
            browser: evidence.browser, exceptions: evidence.exceptions, requests: evidence.requests, snapshot: evidence.snapshot });
    }
    onEnd(result: FullResult) {
        mkdirSync(dirname(this.receiptPath), { recursive: true });
        writeFileSync(this.receiptPath, JSON.stringify({
            version: 2, commit: this.commit, dirty: this.dirty,
            command: this.command, timestamp: new Date().toISOString(), status: result.status,
            tests: this.suite?.allTests().map(test => ({ testId: test.id, case: test.title, outcome: test.outcome(), attempts: test.results.length })),
            cases: this.cases,
        }, null, 2));
    }
}
