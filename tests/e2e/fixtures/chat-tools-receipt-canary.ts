import { expect, test } from '@playwright/test';

// Selected only by the disposable receipt-check runner, never the browser lane.
test.afterEach(async ({ browserName }, info) => {
    await info.attach('chat-tools-evidence', { contentType: 'application/json',
        body: JSON.stringify({ browser: browserName, exceptions: [], requests: 0, snapshot: { marker: info.title } }) });
});
test('case before worker restart', () => {});
test('case retried in a replacement worker', ({ browserName }, info) => { expect(browserName).toBe('chromium'); expect(info.retry).toBe(1); });
test('case after worker restart', () => {});
