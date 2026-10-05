import { expect, test, type Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
test.skip(
    process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS !== 'true',
    'Requires the production journey harness',
);
async function projectState(page: Page) {
    return page.evaluate(async () => {
        const messages: any[] = [];
        const checkpoints: any[] = [];
        const sources: any[] = [];
        for (const entry of await indexedDB.databases()) {
            if (!entry.name) continue;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open(entry.name!);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            for (const table of [
                'messages',
                'chat_request_recoveries',
                'posts',
            ]) {
                if (!db.objectStoreNames.contains(table)) continue;
                const rows = await new Promise<any[]>((resolve, reject) => {
                    const request = db
                        .transaction(table)
                        .objectStore(table)
                        .getAll();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                if (table === 'posts')
                    sources.push(
                        ...rows.filter(
                            (row) =>
                                row.postType === 'or3:project-source' &&
                                !row.deleted,
                        ),
                    );
                else
                    (table === 'messages' ? messages : checkpoints).push(
                        ...rows.filter(
                            (row) => row.thread_id === 'saffron-project-chat',
                        ),
                    );
            }
            db.close();
        }
        return {
            messages,
            checkpoints,
            sources,
            requests: JSON.parse(
                localStorage.getItem('or3:e2e:compaction-requests') ?? '[]',
            ),
        };
    });
}
test.afterEach(async ({ page }, info) => {
    if (info.status === info.expectedStatus) return;
    const path = info.outputPath('failed-project-journey-state.json');
    await writeFile(path, JSON.stringify(await projectState(page), null, 2));
    await info.attach('failed-project-journey-state', {
        path,
        contentType: 'application/json',
    });
});
// Observable failures: lost settings on reload; one project leaking another's memories;
// worker startup, malformed DOCX/PDF handling; failed replacement losing the current source.
function pdf(text: string) {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
    let body = '%PDF-1.4\n';
    const offsets = [0];
    for (const [i, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(body));
        body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(body);
    body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((o) => String(o).padStart(10, '0') + ' 00000 n \n')
        .join(
            '',
        )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(body);
}
test('persistent projects retain settings, extract files, preserve failed replacements, and isolate memory', async ({
    page,
}, info) => {
    test.setTimeout(180000);
    await page.goto('/__or3-projects-journey');
    await expect(
        page.getByRole('heading', { name: 'Projects', exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await page
        .getByRole('textbox', { name: 'New project name' })
        .fill('Saffron');
    await page
        .getByRole('button', { name: 'Create project', exact: true })
        .click();
    await expect(
        page.getByRole('heading', { name: 'Saffron', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
        .getByLabel('Instructions', { exact: true })
        .fill('Prefer concise source-backed answers.');
    await page
        .getByRole('button', { name: 'Save settings', exact: true })
        .click();
    await page.getByRole('button', { name: 'Memory', exact: true }).click();
    await page
        .getByRole('textbox', { name: 'New project memory' })
        .fill('Use saffron deployment.');
    await page
        .getByRole('combobox', { name: 'Memory kind' })
        .selectOption('decision');
    await page
        .getByRole('button', { name: 'Save memory', exact: true })
        .click();
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    const upload = page.getByLabel('Upload project knowledge');
    await upload.setInputFiles({
        name: 'saffron.pdf',
        mimeType: 'application/pdf',
        buffer: pdf('Saffron PDF acceptance marker'),
    });
    const source = page.locator('article').filter({ hasText: 'saffron.pdf' });
    await expect(source).toContainText('ready', { timeout: 45000 });
    await source.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.locator('pre')).toContainText(
        'Saffron PDF acceptance marker',
    );
    await source.getByRole('button', { name: 'Replace', exact: true }).click();
    await upload.setInputFiles({
        name: 'broken.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('not a PDF'),
    });
    await expect(source).toContainText('failed', { timeout: 45000 });
    await expect(source).toContainText('Current · ready');
    const beforeRetry = (await projectState(page)).sources.find(
        (row) => JSON.parse(row.content).title === 'saffron.pdf',
    )!.clock;
    await source.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect
        .poll(
            async () =>
                (await projectState(page)).sources.find(
                    (row) => JSON.parse(row.content).title === 'saffron.pdf',
                )?.clock,
        )
        .toBeGreaterThan(beforeRetry);
    await expect(source).toContainText('Current · ready');

    const docx = zipSync({
        '[Content_Types].xml': strToU8(
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ),
        '_rels/.rels': strToU8(
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        ),
        'word/document.xml': strToU8(
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Saffron DOCX acceptance marker</w:t></w:r></w:p></w:body></w:document>',
        ),
    });
    await upload.setInputFiles({
        name: 'saffron.docx',
        mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from(docx),
    });
    await expect(
        page.locator('article').filter({ hasText: 'saffron.docx' }),
    ).toContainText('ready', { timeout: 45000 });
    await upload.setInputFiles({
        name: 'scanned.pdf',
        mimeType: 'application/pdf',
        buffer: pdf(''),
    });
    await expect(
        page.locator('article').filter({ hasText: 'scanned.pdf' }),
    ).toContainText('OCR', { timeout: 45000 });
    await upload.setInputFiles({
        name: 'oversized.txt',
        mimeType: 'text/plain',
        buffer: Buffer.alloc(20 * 1024 * 1024 + 1, 'a'),
    });
    await expect(page.getByRole('alert')).toContainText(/too large/i);
    await expect(
        page.locator('article').filter({ hasText: 'oversized.txt' }),
    ).toHaveCount(0);
    await page
        .getByRole('textbox', { name: 'Note title', exact: true })
        .fill('Saffron working note');
    await page
        .getByRole('textbox', { name: 'Note text', exact: true })
        .fill('Keep a compact project brief.');
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(
        page.locator('article').filter({ hasText: 'Saffron working note' }),
    ).toContainText('ready');
    await page.reload();
    await page
        .getByRole('button', { name: 'Saffron', exact: false })
        .first()
        .click();
    await page.getByRole('button', { name: 'Memory', exact: true }).click();
    await expect(page.getByLabel('Edit saved decision')).toHaveValue(
        'Use saffron deployment.',
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(
        'Prefer concise source-backed answers.',
    );
    await page
        .getByRole('button', { name: 'All projects', exact: true })
        .click();
    await page.getByRole('textbox', { name: 'New project name' }).fill('Basil');
    await page
        .getByRole('button', { name: 'Create project', exact: true })
        .click();
    await page.getByRole('button', { name: 'Memory', exact: true }).click();
    await expect(page.getByLabel('Edit saved decision')).toHaveCount(0);
    const path = info.outputPath('project-isolation.png');
    await page.screenshot({ path });
    await info.attach('project-isolation', { path, contentType: 'image/png' });
    // Desktop persistence proof does not cover narrow layouts or keyboard inputs.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Instructions', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(
        page.getByLabel('Default model', { exact: true }),
    ).toBeFocused();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    const mobilePath = info.outputPath('project-mobile.png');
    await page.screenshot({ path: mobilePath });
    await info.attach('project-mobile', {
        path: mobilePath,
        contentType: 'image/png',
    });
});

// This owns the exported browser artifact and destructive restore boundary:
// lost internal posts, missing revision bytes, and a deleted memory resurrected
// incorrectly can pass local store tests while breaking a user's portable backup.
test('project backup restores memories and extracted revision bytes', async ({
    page,
}, info) => {
    test.setTimeout(180000);
    // Exercise the real download fallback used by browsers without native save pickers.
    await page.addInitScript(() => {
        Object.defineProperty(window, 'showSaveFilePicker', {
            value: undefined,
            configurable: true,
        });
    });
    await page.goto('/__or3-projects-journey');
    await page
        .getByRole('textbox', { name: 'New project name' })
        .fill('Backup project');
    await page
        .getByRole('button', { name: 'Create project', exact: true })
        .click();
    await page.getByRole('button', { name: 'Memory', exact: true }).click();
    await page
        .getByRole('textbox', { name: 'New project memory' })
        .fill('Backup retained decision');
    await page
        .getByRole('button', { name: 'Save memory', exact: true })
        .click();
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    await page.getByLabel('Upload project knowledge').setInputFiles({
        name: 'retained.pdf',
        mimeType: 'application/pdf',
        buffer: pdf('Backup extraction marker'),
    });
    await expect(
        page.locator('article').filter({ hasText: 'retained.pdf' }),
    ).toContainText('ready', { timeout: 45000 });
    await page
        .getByRole('button', { name: 'Backup and restore', exact: true })
        .click();
    const downloaded = page.waitForEvent('download');
    await page
        .getByRole('button', { name: 'Export workspace', exact: true })
        .click();
    const backup = await downloaded;
    const path = info.outputPath('project-backup.or3.jsonl');
    await backup.saveAs(path);
    await info.attach('project-backup', {
        path,
        contentType: 'application/jsonl',
    });
    const exported = await readFile(path, 'utf8');
    expect(exported).toContain('Backup retained decision');
    expect(exported).toContain('or3:project-source');
    await page
        .getByRole('button', { name: 'Project workspace', exact: true })
        .click();
    await page
        .getByRole('button', { name: 'Backup project', exact: false })
        .first()
        .click();
    await page.getByRole('button', { name: 'Memory', exact: true }).click();
    await page
        .getByRole('button', { name: 'Delete memory', exact: true })
        .click();
    await expect(page.getByLabel('Edit saved fact')).toHaveCount(0);
    await page
        .getByRole('button', { name: 'Backup and restore', exact: true })
        .click();
    await page.locator('input[type=file]').setInputFiles(path);
    await page.getByRole('button', { name: /Replace workspace/ }).click();
    await page
        .getByRole('button', { name: 'Import workspace', exact: true })
        .click();
    await expect(page.getByText(/Last import/).first()).toBeVisible({
        timeout: 60000,
    });
    await page
        .getByRole('button', { name: 'Project workspace', exact: true })
        .click();
    await page
        .getByRole('button', { name: 'Backup project', exact: false })
        .first()
        .click();
    await page.getByRole('button', { name: 'Memory', exact: true }).click();
    await expect(page.getByLabel('Edit saved fact')).toHaveValue(
        'Backup retained decision',
    );
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    await page
        .locator('article')
        .filter({ hasText: 'retained.pdf' })
        .getByRole('button', { name: 'Preview', exact: true })
        .click();
    await expect(page.locator('pre')).toContainText('Backup extraction marker');
});

test('project A keeps its captured context while project B opens during streaming', async ({
    page,
}, info) => {
    test.setTimeout(120000);
    await page.route('**openrouter.ai/**', (route) => route.abort());
    await page.goto('/__or3-chat-journey-test?project=1');
    const input = page.getByRole('textbox', { name: 'Message input' });
    await expect(input).toBeVisible({ timeout: 60000 });
    await input.fill('journey:project-pane saffron');
    await page
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
    await expect
        .poll(async () => (await projectState(page)).requests.length)
        .toBe(1);
    await expect(
        page.getByRole('button', { name: 'Stop generation' }),
    ).toBeVisible();
    await page
        .getByRole('button', { name: 'Projects', exact: true })
        .first()
        .click();
    await page
        .getByRole('button', { name: /Basil isolation project/ })
        .last()
        .click();
    await expect(
        page.getByRole('heading', {
            name: 'Basil isolation project',
            exact: true,
        }),
    ).toBeVisible();
    await expect
        .poll(
            async () =>
                (await projectState(page)).messages.find(
                    (row) => row.role === 'assistant',
                )?.data.content,
            { timeout: 15000 },
        )
        .toBe('Hello from deterministic stream.');
    const state = await projectState(page);
    expect(state.requests).toHaveLength(1);
    expect(JSON.stringify(state.requests[0])).toContain(
        'Saffron saved decision marker',
    );
    expect(JSON.stringify(state.requests[0])).not.toContain(
        'Basil secret isolation marker',
    );
    const path = info.outputPath('project-pane-capture.json');
    await writeFile(path, JSON.stringify(state, null, 2));
    await info.attach('project-pane-capture', {
        path,
        contentType: 'application/json',
    });
});

// The real native send path owns this contract: request capture must contain the
// owning project's state and actual vision input, and survive inspector reload.
// The standalone Home journey cannot detect inference or foreground pane races.
test('project chat submits only its captured context and persists the inspector', async ({
    page,
}, info) => {
    test.setTimeout(120000);
    await page.route('**openrouter.ai/**', (route) => route.abort());
    await page.goto('/__or3-chat-journey-test?project=1&context=1');
    page.on('console', (message) => {
        if (message.type() === 'error')
            console.log(
                '[project browser error]',
                message.text().slice(0, 2000),
            );
    });
    const input = page.getByRole('textbox', { name: 'Message input' });
    await expect(input).toBeVisible({ timeout: 60000 });
    await input.fill(
        'journey:context-reject Saffron project acceptance request',
    );
    await page
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
    await expect
        .poll(
            async () =>
                (await projectState(page)).messages.find(
                    (row) => row.role === 'assistant',
                )?.error,
        )
        .toBe('context_full');
    const failed = await projectState(page);
    expect(failed.checkpoints).toHaveLength(1);
    await expect(
        page.getByRole('button', { name: 'Retry message', exact: true }).last(),
    ).toBeVisible({ timeout: 30000 });
    await page.reload();
    await expect(input).toBeVisible({ timeout: 60000 });
    await page.evaluate(() =>
        window.dispatchEvent(
            new CustomEvent('or3:model-selected', {
                detail: { modelId: 'context-fixture-large' },
            }),
        ),
    );
    await page
        .getByRole('button', { name: 'Retry message', exact: true })
        .last()
        .click();
    await expect(
        page.getByText('Hello from deterministic stream.', { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const requests = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('or3:e2e:compaction-requests') ?? '[]'),
    );
    const recovered = await projectState(page);
    expect(recovered.checkpoints).toHaveLength(0);
    expect(
        recovered.messages
            .filter((row) => row.role === 'user')
            .map((row) => row.id),
    ).toEqual(
        failed.messages
            .filter((row) => row.role === 'user')
            .map((row) => row.id),
    );
    expect(
        recovered.messages
            .filter((row) => row.role === 'assistant')
            .map((row) => row.id),
    ).toEqual(
        failed.messages
            .filter((row) => row.role === 'assistant')
            .map((row) => row.id),
    );
    expect(requests).toHaveLength(2);
    expect(recovered.sources).toHaveLength(2);
    expect(requests[1].messages).toEqual(requests[0].messages);
    const body = JSON.stringify(requests[0]);
    expect(body).toContain('Saffron instruction marker');
    expect(body).toContain('Saffron brief marker');
    expect(body).toContain('Saffron saved decision marker');
    expect(body).toContain('preserve the original source');
    expect(body).toContain('data:image/png;base64,');
    expect(body).not.toContain('Basil secret isolation marker');
    expect(
        requests[0].tools.some((tool: any) =>
            [
                'search_threads',
                'search_documents',
                'get_open_pane_context',
            ].includes(tool.function.name),
        ),
    ).toBe(false);
    const indicator = page.getByRole('button', {
        name: 'Context · 2 sources · 1 saved decisions',
    });
    await expect(indicator).toBeVisible();
    await indicator.click();
    await expect(
        page.getByText('Saffron instruction marker: preserve evidence.', {
            exact: true,
        }),
    ).toBeVisible();
    await page.reload();
    await expect(indicator).toBeVisible({ timeout: 60000 });
    await indicator.click();
    await expect(
        page.getByText('Saffron instruction marker: preserve evidence.', {
            exact: true,
        }),
    ).toBeVisible();
    await info.attach('submitted-project-request', {
        body: JSON.stringify(requests, null, 2),
        contentType: 'application/json',
    });
    // Saving a response is an explicit, reviewed operation with real message provenance.
    await page
        .getByRole('button', { name: 'Remember for this project', exact: true })
        .last()
        .click();
    await expect(page.getByLabel('Review memory', { exact: true })).toHaveValue(
        'Hello from deterministic stream.',
    );
    await page
        .getByRole('button', { name: 'Save memory', exact: true })
        .click();
    await expect(
        page.getByRole('status').filter({ hasText: 'Saved to project.' }),
    ).toBeVisible();
    const path = info.outputPath('project-context-inspector.png');
    await page.screenshot({ path });
    await info.attach('project-context-inspector', {
        path,
        contentType: 'image/png',
    });
});

// Handoffs must retain ownership and captured project context, remain reviewable,
// and disappear when their original evidence is excluded. Store tests cannot
// detect broken Home suggestions or inference integration.
test('project handoff keeps ownership and offers a reviewed brief before evidence exclusion', async ({
    page,
}, info) => {
    test.setTimeout(120000);
    await page.route('**openrouter.ai/**', (route) => route.abort());
    await page.goto('/__or3-chat-journey-test?project=1&compaction=1');
    await expect(page.getByTestId('fixture-compact')).toBeVisible({
        timeout: 60000,
    });
    await page.getByTestId('fixture-compact').click();
    await expect(page.locator('[data-compaction-card]')).toBeVisible({
        timeout: 30000,
    });
    const requests = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('or3:e2e:compaction-requests') ?? '[]'),
    );
    expect(requests).toHaveLength(1);
    const body = JSON.stringify(requests[0]);
    expect(body).toContain('Saffron instruction marker');
    expect(body).toContain('Saffron saved decision marker');
    expect(body).not.toContain('Basil secret isolation marker');
    expect(body).not.toContain('data:image/png');
    await page
        .getByRole('button', { name: 'Projects', exact: true })
        .first()
        .click();
    await page
        .getByRole('button', { name: /Workspace fixture project/ })
        .last()
        .click();
    await page.getByRole('button', { name: 'Memory', exact: true }).click();
    await page
        .getByRole('button', {
            name: 'Review handoff suggestions',
            exact: true,
        })
        .click();
    await expect(
        page.getByText('Handoff from Compaction original evidence', {
            exact: false,
        }),
    ).toBeVisible();
    await expect(page.getByLabel('Project brief', { exact: true })).toHaveValue(
        'Saffron brief marker: current implementation.',
    );
    await page
        .getByRole('button', { name: 'Review as brief', exact: true })
        .click();
    await expect(page.getByLabel('Project brief', { exact: true })).toHaveValue(
        /Preserve app\/example.ts exactly/,
    );
    await page.getByRole('button', { name: 'Save brief', exact: true }).click();
    await expect(page.getByLabel('Edit saved decision')).toHaveCount(1);
    await page
        .getByRole('button', { name: 'Chats', exact: true })
        .last()
        .click();
    const row = page.locator('div.flex.items-center.gap-3').filter({
        has: page.getByRole('button', {
            name: 'Compaction original evidence',
            exact: true,
        }),
    });
    await row
        .getByRole('button', { name: 'Exclude from memory', exact: true })
        .click();
    await page.getByRole('button', { name: 'Memory', exact: true }).click();
    await page
        .getByRole('button', {
            name: 'Review handoff suggestions',
            exact: true,
        })
        .click();
    await expect(
        page.getByRole('button', { name: 'Review as brief', exact: true }),
    ).toHaveCount(0);
    await info.attach('project-handoff-request', {
        body: JSON.stringify(requests, null, 2),
        contentType: 'application/json',
    });
});
