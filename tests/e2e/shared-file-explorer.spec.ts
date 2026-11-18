import { expect, test, type Locator, type Page } from '@playwright/test';

test.setTimeout(90_000);
test.use({ actionTimeout: 15_000 });

async function createFolder(page: Page, files: Locator, parent: string, name: string) {
    const title = `New folder in ${parent}`;
    await expect(files.getByRole('button', { name: title, exact: true })).toBeVisible({ timeout: 45_000 });
    await files.getByRole('button', { name: title, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: title });
    await dialog.getByRole('textbox', { name: 'Folder name' }).fill(name);
    await dialog.getByRole('button', { name: 'Create folder' }).click();
    await expect(dialog).toBeHidden();
    await expect(files.getByRole('button', { name, exact: true })).toBeVisible();
}

async function upload(files: Locator, name: string, text: string, mimeType = 'text/plain') {
    await files.getByLabel('Upload files', { exact: true }).setInputFiles({
        name, mimeType, buffer: Buffer.from(text),
    });
    await expect(files.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible();
}

async function dragRow(page: Page, from: Locator, to: Locator, allowed = true) {
    await from.scrollIntoViewIfNeeded();
    await to.scrollIntoViewIfNeeded();
    const source = await from.getByRole('button').filter({ hasText: /\S/ }).first().boundingBox();
    if (!source) throw new Error('Missing visible drag source.');
    const x = source.x + source.width / 2;
    const y = source.y + source.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y, { steps: 3 });
    await expect(from.locator('xpath=ancestor::*[@data-explorer-dragging][1]'))
        .toHaveAttribute('data-explorer-dragging', 'true');
    const target = await to.boundingBox();
    if (!target) throw new Error('Missing visible drag destination.');
    const endX = target.x + target.width / 2;
    const endY = target.y + target.height / 2;
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.move(endX + 1, endY + 1);
    if (allowed) await expect(to).toHaveAttribute('data-explorer-drop', 'true');
    else await expect(to).not.toHaveAttribute('data-explorer-drop', 'true');
    await page.mouse.up();
}

test('organizes actual Files through selection, drag, breadcrumbs and Move to', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/_tests/_test-storage');
    const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
    const breadcrumbs = files.getByRole('navigation', { name: 'Files location' });
    await createFolder(page, files, 'Files', 'Research');
    await files.getByRole('button', { name: 'New folder in Files' }).click();
    const duplicate = page.getByRole('dialog', { name: 'New folder in Files' });
    await duplicate.getByRole('textbox', { name: 'Folder name' }).fill('Research');
    await duplicate.getByRole('button', { name: 'Create folder' }).click();
    await expect(duplicate.getByRole('alert')).toContainText('already exists');
    await duplicate.getByRole('button', { name: 'Cancel' }).click();
    await expect(files.getByText(/already exists/)).toHaveCount(0);
    await upload(files, 'alpha.txt', 'Alpha original content');
    await upload(files, 'beta.txt', 'Beta original content');
    const alpha = files.getByRole('button', { name: 'Open alpha.txt', exact: true });
    const beta = files.getByRole('button', { name: 'Open beta.txt', exact: true });
    await alpha.click({ modifiers: ['ControlOrMeta'] });
    await beta.click({ modifiers: ['Shift'] });
    await expect(files.getByText('2 selected', { exact: true })).toBeVisible();
    await expect(files.getByRole('complementary', { name: 'File preview' })).toBeHidden();

    await files.getByRole('button', { name: 'Move to…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Move within Files' });
    await dialog.getByRole('radio', { name: 'Research', exact: true }).check();
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(alpha).toBeHidden();
    await files.getByRole('button', { name: 'Research', exact: true }).click();
    await expect(alpha).toBeVisible();
    await createFolder(page, files, 'Research', 'Notes');

    const alphaRow = files.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Open alpha.txt', exact: true }) });
    const notesRow = files.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Notes', exact: true }) });
    await dragRow(page, alphaRow, notesRow);
    await expect(alpha).toBeHidden();
    await files.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(alpha).toBeVisible();
    await alpha.click();
    await expect(files.getByRole('complementary', { name: 'File preview' })).toContainText('Alpha original content');

    await files.getByRole('button', { name: 'Close', exact: true }).click();
    await dragRow(page, alphaRow, breadcrumbs.getByRole('button', { name: 'Files', exact: true }));
    await expect(alpha).toBeHidden();
    await breadcrumbs.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(alpha).toBeVisible();
    await expect(beta).toBeHidden();

    await alpha.click({ modifiers: ['ControlOrMeta'] });
    await files.getByRole('button', { name: 'Move 1 item to Trash' }).click();
    const trashDialog = page.getByRole('dialog', { name: 'Move 1 item to Trash' });
    await trashDialog.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await expect(trashDialog).toBeHidden();
    await expect(alpha).toBeHidden();
    await files.getByRole('button', { name: 'Trash', exact: true }).click();
    await files.getByRole('button', { name: 'Restore', exact: true }).click();
    await files.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(alpha).toBeVisible();

    await createFolder(page, files, 'Files', 'Archive');
    const folderRow = (name: string) => files.getByRole('listitem').filter({ has: page.getByRole('button', { name, exact: true }) });
    await dragRow(page, folderRow('Research'), folderRow('Archive'));
    await expect(folderRow('Research')).toHaveCount(0);
    await page.reload();
    await folderRow('Archive').getByRole('button', { name: 'Archive', exact: true }).click();
    await folderRow('Research').getByRole('button', { name: 'Research', exact: true }).click();
    await expect(beta).toBeVisible();
    await folderRow('Notes').getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(breadcrumbs.getByRole('button')).toHaveText(['Files', 'Archive', 'Research', 'Notes']);

    await page.screenshot({ path: info.outputPath('files-explorer.png') });
    await info.attach('local-interaction-receipt', { body: JSON.stringify({
        mode: 'local', folderNames: ['Research', 'Notes'], moved: ['alpha.txt', 'beta.txt'],
        checks: ['modified selection', 'Move to dialog', 'drag to empty folder', 'drag to root breadcrumb', 'preview original', 'bulk Trash and restore'],
    }), contentType: 'application/json' });
});

for (const theme of ['blank', 'retro', 'cyberpunk']) {
    test(`uses the ${theme} palette in a narrow Files pane`, async ({ page }, info) => {
        await page.setViewportSize({ width: 320, height: 740 });
        await page.context().addCookies([{ name: 'or3_active_theme', value: theme, domain: '127.0.0.1', path: '/' }]);
        await page.addInitScript(theme => {
            localStorage.setItem('activeTheme', theme);
            localStorage.setItem('theme', 'dark');
        }, theme);
        await page.goto('/_tests/_test-storage');
        const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 30_000 });
        await createFolder(page, files, 'Files', 'Reading list');
        const folder = files.getByRole('button', { name: 'Reading list', exact: true });
        await files.getByRole('button', { name: 'Select', exact: true }).click();
        await expect(files.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
        // Scroll the folder into view after the selection toolbar takes its space.
        await folder.scrollIntoViewIfNeeded();
        await expect(folder).toBeInViewport();
        await folder.click();
        await expect(files.getByText('1 selected', { exact: true })).toBeVisible();
        await expect(files.getByRole('navigation', { name: 'Files location' })).not.toContainText('Reading list');
        expect(await files.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(await files.evaluate(element => element.clientWidth));
        await page.screenshot({ path: info.outputPath('files-explorer-phone.png') });
    });
}


async function createProject(page: Page, name: string) {
    const navigation = page.getByRole('complementary', { name: 'Navigation' })
        .or(page.getByRole('dialog', { name: 'Navigation' }));
    await navigation.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'New project', exact: true }).click();
    const projectDialog = page.getByRole('dialog', { name: 'New Project', exact: true });
    await projectDialog.getByPlaceholder('Project title').fill(name);
    await projectDialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(projects.getByRole('heading', { name, exact: true })).toBeVisible();
    return projects;
}

test.describe('Project explorer scrolling', () => {
    for (const [name, viewport, hasTouch] of [
        ['phone', { width: 390, height: 750 }, true],
        ['desktop', { width: 1440, height: 900 }, false],
    ] as const) {
        test.describe(name, () => {
            test.use({ viewport, hasTouch });
            test('scrolls the project overview and Home shortcuts through the last tree row', async ({ page, browserName, context }) => {
                let clientUrl: string | undefined;
                page.on('request', request => {
                    if (/\/db\/client\.ts(?:\?|$)/u.test(request.url())) clientUrl = request.url();
                });
                await page.addLocatorHandler(page.getByRole('button', { name: 'Dismiss welcome' }), button => button.click());
                await page.goto('/chat');
                if (hasTouch) {
                    const sidebar = page.getByRole('button', { name: 'Open sidebar', exact: true }).first();
                    await expect(sidebar).toBeVisible();
                    await sidebar.click();
                }
                const projects = await createProject(page, 'Long project');
                if (!clientUrl) throw new Error('Workspace DB module did not load.');
                await page.evaluate(async url => {
                    const { getDb } = await import(url);
                    const db = getDb();
                    const project = await db.projects.filter((row: { name: string }) => row.name === 'Long project').first();
                    if (!project) throw new Error('Expected the disposable project.');
                    const docs = Array.from({ length: 180 }, (_, index) => ({
                        id: 'scroll-doc-' + index,
                        title: 'Chapter ' + String(index).padStart(3, '0'),
                        postType: 'doc', content: '{"type":"doc","content":[]}',
                        clock: 1, created_at: 1, updated_at: 1, deleted: false,
                    }));
                    await db.posts.bulkPut(docs);
                    await db.projects.update(project.id, { data: docs.map(doc => ({ id: doc.id, kind: 'doc' })) });
                }, clientUrl);
                const cdp = hasTouch && browserName === 'chromium' ? await context.newCDPSession(page) : undefined;
                const scrollTree = async (container: Locator, heading: Locator) => {
                    const tree = container.getByRole('tree', { name: 'Project contents' });
                    const first = tree.getByRole('button', { name: 'Chapter 000', exact: true });
                    const last = tree.getByRole('button', { name: 'Chapter 179', exact: true });
                    await expect(heading).toBeInViewport();
                    await expect(first).toBeInViewport();
                    const bounds = await first.boundingBox();
                    if (!bounds) throw new Error('Missing first row.');
                    const x = Math.round(bounds.x + bounds.width / 2);
                    const y = Math.round(bounds.y + bounds.height / 2);
                    if (cdp) await cdp.send('Input.synthesizeScrollGesture', {
                        x, y, yDistance: -640, gestureSourceType: 'touch', speed: 1400,
                    });
                    else {
                        await page.mouse.move(x, y);
                        await page.mouse.wheel(0, 640);
                    }
                    await expect(heading).not.toBeInViewport();
                    await page.mouse.move(x, y);
                    await expect.poll(async () => {
                        if (await last.count() && await last.evaluate(element => {
                            const row = element.getBoundingClientRect();
                            const clip = element.closest('.or3-scroll')!.getBoundingClientRect();
                            return row.bottom > clip.top && row.top < clip.bottom;
                        })) return true;
                        await page.mouse.wheel(0, 1250);
                        return false;
                    }, { intervals: [300], timeout: 20_000 }).toBe(true);
                    await expect(last).toBeInViewport();
                    expect(await tree.getByRole('treeitem').count()).toBeLessThan(75);
                    await last.press('Home');
                    await expect(first).toBeFocused();
                    await first.press('End');
                    await expect(last).toBeFocused();
                };
                await scrollTree(projects, projects.getByRole('heading', { name: 'Long project' }));
                const navigation = page.getByRole('complementary', { name: 'Navigation' })
                    .or(page.getByRole('dialog', { name: 'Navigation' }));
                await navigation.getByRole('button', { name: 'Home', exact: true }).first().click();
                const shortcut = navigation.getByRole('button', { name: /^(Expand|Collapse) Long project shortcuts$/ });
                await expect(shortcut).toBeVisible();
                if (await shortcut.getAttribute('aria-expanded') === 'true') await shortcut.click();
                await shortcut.click();
                const recent = navigation.getByRole('region', { name: 'Project shortcuts for Long project', exact: true });
                await scrollTree(recent, navigation.getByRole('button', { name: 'Open project Long project', exact: true }));
            });
        });
    }
});

test('Project Home opens its explorer and creates a document in a folder', async ({ page }, info) => {
    await page.goto('/chat');
    await expect(page.getByRole('textbox', { name: 'Message input' }).first()).toBeVisible({ timeout: 45_000 });
    const dismiss = page.getByRole('button', { name: 'Dismiss welcome' });
    if (await dismiss.isVisible()) await dismiss.click();
    const navigation = page.getByRole('complementary', { name: 'Navigation' });
    const projects = await createProject(page, 'Test Library');
    await expect(projects.getByRole('button', { name: 'Explorer', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await projects.getByRole('button', { name: 'Explorer', exact: true }).click();
    const explorer = projects.getByRole('region', { name: 'Project Explorer' });
    await createFolder(page, explorer, 'Test Library', 'Notes');
    await explorer.getByRole('button', { name: 'Notes', exact: true }).press('F2');
    const rename = page.getByRole('dialog', { name: 'Rename folder in project Test Library' });
    await expect(rename.getByRole('textbox', { name: 'Folder name' })).toHaveValue('Notes');
    await rename.getByRole('button', { name: 'Cancel' }).click();
    await explorer.getByRole('button', { name: 'More actions for Notes' }).click();
    await page.getByRole('button', { name: 'New document in Notes', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Document title' })).toBeVisible();
    await explorer.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(explorer.getByRole('button', { name: 'Untitled', exact: true })).toBeVisible();
    await explorer.getByRole('button', { name: 'More actions for Untitled' }).click();
    await page.getByRole('button', { name: 'Show in Files', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Workspace Files' })
        .getByRole('button', { name: 'Open Untitled', exact: true })).toBeFocused();
    await createFolder(page, explorer, 'Test Library', 'Archive');
    const documentRow = explorer.locator('[data-project-row]').filter({ has: page.getByRole('button', { name: 'Untitled', exact: true }) });
    const archiveRow = explorer.locator('[data-project-row]').filter({ has: page.getByRole('button', { name: 'Archive', exact: true }) });
    await dragRow(page, documentRow, archiveRow);
    await expect(documentRow).toHaveAttribute('title', 'Archive / Untitled');
    await dragRow(page, documentRow, projects.getByRole('heading', { name: 'Test Library', exact: true }));
    await expect(documentRow).toHaveAttribute('title', 'Untitled');
    const notesRow = explorer.locator('[data-project-row]').filter({ has: page.getByRole('button', { name: 'Notes', exact: true }) });
    await dragRow(page, documentRow, notesRow);
    await expect(documentRow).toHaveAttribute('title', 'Notes / Untitled');
    await explorer.getByRole('button', { name: 'More actions for Notes' }).click();
    await page.getByRole('button', { name: 'New folder in Notes', exact: true }).click();
    const nested = page.getByRole('dialog', { name: 'New folder in Notes' });
    await nested.getByRole('textbox', { name: 'Folder name' }).fill('Drafts');
    await nested.getByRole('button', { name: 'Create folder' }).click();
    await expect(nested).toBeHidden();
    const drafts = explorer.locator('[data-project-row]').filter({ has: page.getByRole('button', { name: 'Drafts', exact: true }) });
    await dragRow(page, notesRow, archiveRow);
    await expect(drafts).toHaveAttribute('title', 'Archive / Notes / Drafts');
    await expect(documentRow).toHaveAttribute('title', 'Archive / Notes / Untitled');
    await dragRow(page, archiveRow, drafts, false);
    await expect(archiveRow).toHaveAttribute('title', 'Archive');
    await expect(documentRow).toHaveAttribute('title', 'Archive / Notes / Untitled');
    await page.screenshot({ path: info.outputPath('project-explorer.png') });
    const externalPrevented = await explorer.evaluate(element => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['sample'], 'external.txt', { type: 'text/plain' }));
        return !element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    expect(externalPrevented).toBe(true);
    await expect(explorer.getByRole('alert')).toContainText('For uploads');
    await navigation.getByRole('button', { name: 'Home', exact: true }).click();
    const shortcut = navigation.getByRole('region', { name: 'Project shortcuts for Test Library' });
    const closedShortcut = navigation.getByRole('button', { name: 'Expand Test Library shortcuts', exact: true });
    if (await closedShortcut.isVisible()) await closedShortcut.click();
    await expect(shortcut.getByRole('button', { name: 'Untitled', exact: true })).toBeVisible();
    await shortcut.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(shortcut.getByRole('button', { name: 'Untitled', exact: true })).toBeHidden();
    await shortcut.getByRole('button', { name: 'Notes', exact: true }).click();
    await shortcut.getByRole('button', { name: 'Untitled', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Document title' })).toBeVisible();
});

test('project folder actions create a chat and attach, locate, and remove a saved file', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addLocatorHandler(page.getByRole('button', { name: 'Dismiss welcome' }), button => button.click());
    await page.goto('/chat');
    const navigation = page.getByRole('complementary', { name: 'Navigation' });
    await navigation.getByRole('button', { name: 'Files', exact: true }).click({ timeout: 45_000 });
    const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
    await upload(files, 'source.txt', 'The original project source');

    const projects = await createProject(page, 'Library');
    const explorer = projects.getByRole('region', { name: 'Project Explorer' });
    await createFolder(page, explorer, 'Library', 'Reference');
    const actions = explorer.getByRole('button', { name: 'More actions for Reference' });
    await actions.click();
    await page.getByRole('button', { name: 'New chat in Reference', exact: true }).click();
    const expand = explorer.getByRole('button', { name: 'Expand Reference', exact: true });
    if (await expand.isVisible()) await expand.click();
    const row = (name: string) => explorer.locator('[data-project-row]').filter({ has: page.getByRole('button', { name, exact: true }) });
    await expect(row('New chat')).toHaveAttribute('title', 'Reference / New chat');
    await actions.click();
    await page.getByRole('button', { name: 'Add file in Reference', exact: true }).click();
    await projects.getByRole('combobox', { name: 'Existing workspace file' }).selectOption({ label: 'source.txt' });
    await projects.getByRole('button', { name: 'Add saved file', exact: true }).click();
    await expect(row('source.txt')).toHaveAttribute('title', 'Reference / source.txt');

    const fileActions = explorer.getByRole('button', { name: 'More actions for source.txt', exact: true });
    await fileActions.click();
    await page.getByRole('button', { name: 'Show in Files', exact: true }).click();
    const original = files.getByRole('button', { name: 'Open source.txt', exact: true });
    await original.click();
    const preview = files.getByRole('complementary', { name: 'File preview' });
    await expect(preview).toContainText('The original project source');
    await preview.getByRole('button', { name: 'Show in project Library' }).click();
    await expect(row('source.txt')).toHaveAttribute('title', 'Reference / source.txt');
    await fileActions.click();
    await page.getByRole('button', { name: 'Remove from project Library', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove from project', exact: true }).click();
    await expect(row('source.txt')).toHaveCount(0);
    await expect(row('New chat')).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Show in project Library' })).toHaveCount(0);
    await expect(preview).toContainText('The original project source');
});

test('virtualizes a complete Files selection at the planned fixture size', async ({ page }, info) => {
    await page.goto('/_tests/_test-storage');
    const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
    await expect(page.getByTestId('storage-ready')).toHaveText('true', { timeout: 30_000 });
    await page.getByTestId('seed-explorer-fixture').click();

    await expect(files.getByText('5481 items', { exact: true })).toBeVisible({ timeout: 30_000 });
    await files.getByRole('combobox', { name: 'Sort Files' }).click();
    await page.getByRole('option', { name: 'Name', exact: true }).click();
    const first = files.getByRole('button', { name: 'Folder 000', exact: true });
    const last = files.getByRole('button', { name: 'Open Document 4999', exact: true });
    await first.press('End');
    await expect(last).toBeFocused();
    await last.press('Home');
    await expect(first).toBeFocused();
    const liveRows = await files.getByRole('listitem').count();
    expect(liveRows).toBeLessThan(150);
    await files.getByRole('button', { name: 'Select', exact: true }).click();
    await files.getByRole('button', { name: 'Select all results', exact: true }).click();
    await expect(files.getByText('5481 selected', { exact: true })).toBeVisible();
    await expect(files.getByRole('button', { name: 'Move to…', exact: true })).toBeDisabled();
    await info.attach('scale-selection', { body: JSON.stringify({ documents: 5000, folders: 500, depth: 20, liveRows, selected: 5481 }),
        contentType: 'application/json' });
});

test('creating a move destination saves the folder independently of the move', async ({ page }) => {
    await page.goto('/_tests/_test-storage');
    const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
    await upload(files, 'move-source.txt', 'A retained original');
    const row = files.getByRole('button', { name: 'Open move-source.txt', exact: true });
    await row.click({ modifiers: ['ControlOrMeta'] });
    await files.getByRole('button', { name: 'Move to…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Move within Files' });
    await dialog.getByRole('button', { name: 'New folder in Files root', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Folder name' }).fill('New destination');
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'New destination', exact: true })).toBeChecked();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row).toBeVisible();
    await files.getByRole('button', { name: 'New destination', exact: true }).click();
    await expect(row).toBeHidden();
});

test('updates an active folder search when a matching file moves in from another tab', async ({ page, context }) => {
    await page.addLocatorHandler(page.getByRole('button', { name: 'Dismiss welcome' }), button => button.click());
    await page.goto('/chat');
    await page.getByRole('complementary', { name: 'Navigation' }).getByRole('button', { name: 'Files', exact: true }).click({ timeout: 45_000 });
    const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
    await createFolder(page, files, 'Files', 'Research');
    await upload(files, 'sample-outside.txt', 'Outside search sample');
    await files.getByRole('button', { name: 'Research', exact: true }).click();
    const [uploadHere] = await Promise.all([
        page.waitForEvent('filechooser'),
        files.getByRole('button', { name: 'Upload to Research', exact: true }).click(),
    ]);
    await uploadHere.setFiles({ name: 'sample-inside.txt', mimeType: 'text/plain', buffer: Buffer.from('Inside search sample') });
    await expect(files.getByRole('button', { name: 'Open sample-inside.txt' })).toBeVisible();
    const search = files.getByRole('textbox', { name: 'Search Files' });
    await search.fill('absent-search-term');
    await expect(files.getByRole('heading', { name: 'No matching files' })).toBeVisible();
    await search.fill('sample');
    await expect(files.getByRole('combobox', { name: 'Search location' })).toContainText('This folder');
    await expect(files.getByRole('button', { name: 'Open sample-inside.txt' })).toBeVisible();
    await expect(files.getByRole('button', { name: 'Open sample-outside.txt' })).toBeHidden();

    const peer = await context.newPage();
    await peer.goto('/_tests/_test-storage');
    const peerFiles = peer.getByRole('region', { name: 'Workspace Files', exact: true });
    await peerFiles.getByRole('combobox', { name: 'File type' }).click();
    await peer.getByRole('option', { name: 'Uploads', exact: true }).click();
    await peerFiles.getByRole('combobox', { name: 'Search location' }).click();
    await peer.getByRole('option', { name: 'All Files', exact: true }).click();
    await peerFiles.getByRole('button', { name: 'Open sample-outside.txt' }).click({ modifiers: ['ControlOrMeta'] });
    await peerFiles.getByRole('button', { name: 'Move to…', exact: true }).click();
    const move = peer.getByRole('dialog', { name: 'Move within Files' });
    await move.getByRole('radio', { name: 'Research', exact: true }).check();
    await move.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(move).toBeHidden();
    await page.bringToFront();
    await expect(files.getByRole('button', { name: 'Open sample-outside.txt' })).toBeVisible();
});

test('Files Undo preserves originals and Type sorting survives reload', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/_tests/_test-storage');
    const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
    await createFolder(page, files, 'Files', 'Reference');
    await upload(files, 'Field notes.txt', 'Original Field notes content');
    await upload(files, 'Index.csv', 'Title,Author\nField notes,Team', 'text/csv');
    const sort = files.getByRole('combobox', { name: 'Sort Files' });
    await sort.click();
    await page.getByRole('option', { name: 'Type', exact: true }).click();
    const visibleTypes = files.getByRole('listitem').locator('.files-type-column');
    await expect(visibleTypes).toHaveText(['Folder', 'Spreadsheet', 'Text']);
    await page.reload();
    await expect(sort).toContainText('Type', { timeout: 30_000 });
    await expect(visibleTypes).toHaveText(['Folder', 'Spreadsheet', 'Text']);
    const notes = files.getByRole('button', { name: 'Open Field notes.txt' });
    await notes.click({ modifiers: ['ControlOrMeta'] });
    await files.getByRole('button', { name: 'Move to…', exact: true }).click();
    const move = page.getByRole('dialog', { name: 'Move within Files' });
    await move.getByRole('radio', { name: 'Reference', exact: true }).check();
    await move.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(notes).toBeHidden();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(notes).toBeVisible();

    await notes.click();
    await expect(files.getByRole('complementary', { name: 'File preview' })).toContainText('Original Field notes content');
    await files.screenshot({ path: info.outputPath('files-preview.png') });
    await files.getByRole('button', { name: 'Close', exact: true }).click();
    await files.getByRole('button', { name: 'Reference', exact: true }).press('F2');
    const rename = page.getByRole('dialog', { name: 'Rename folder in Files' });
    await rename.getByRole('textbox', { name: 'Folder name' }).fill('Archive');
    await rename.getByRole('button', { name: 'Save name' }).click();
    const renamed = files.getByRole('button', { name: 'Archive', exact: true });
    await expect(renamed).toBeVisible();
    await files.getByRole('textbox', { name: 'Search Files' }).press('ControlOrMeta+z');
    await expect(renamed).toBeVisible();
    await renamed.press('ControlOrMeta+z');
    await expect(files.getByRole('button', { name: 'Reference', exact: true })).toBeVisible();
});

test('duplicate intake reveals the existing Files location and folder removal keeps the original', async ({ page }) => {
    await page.goto('/_tests/_test-storage');
    const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
    const root = files.getByRole('navigation', { name: 'Files location' });
    await createFolder(page, files, 'Files', 'Research');
    await upload(files, 'Unfiled.txt', 'A separate root item');
    await files.getByRole('button', { name: 'Research', exact: true }).click();
    const [picker] = await Promise.all([
        page.waitForEvent('filechooser'),
        files.getByRole('button', { name: 'Upload to Research', exact: true }).click(),
    ]);
    await picker.setFiles({
        name: 'Findings.txt', mimeType: 'text/plain', buffer: Buffer.from('The retained research sample'),
    });
    await expect(files.getByRole('button', { name: 'Open Findings.txt' })).toBeVisible();
    await root.getByRole('button', { name: 'Files', exact: true }).click();
    await files.getByLabel('Upload files', { exact: true }).setInputFiles({
        name: 'Findings.txt', mimeType: 'text/plain', buffer: Buffer.from('The retained research sample'),
    });
    await files.getByRole('button', { name: 'Show in Files', exact: true }).click();
    await expect(root).toContainText('Research');
    await expect(files.getByRole('button', { name: 'Open Findings.txt' })).toHaveCount(1);
    await files.getByRole('combobox', { name: 'File type' }).click();
    await page.getByRole('option', { name: 'Uploads', exact: true }).click();
    await expect(files.getByRole('button', { name: 'Open Unfiled.txt' })).toBeHidden();
    await files.getByRole('combobox', { name: 'Search location' }).click();
    await page.getByRole('option', { name: 'All Files', exact: true }).click();
    await expect(files.getByRole('button', { name: 'Open Unfiled.txt' })).toBeVisible();
    await files.getByRole('combobox', { name: 'File type' }).click();
    await page.getByRole('option', { name: 'All types', exact: true }).click();
    await root.getByRole('button', { name: 'Files', exact: true }).click();
    await files.getByRole('button', { name: 'More actions for Research', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Remove folder, keep contents' }).click();
    const removal = page.getByRole('dialog', { name: 'Remove folder, keep contents' });
    await expect(removal).toContainText('1 file');
    await expect(removal).toContainText('Files root');
    await removal.getByRole('button', { name: 'Remove folder', exact: true }).click();
    await expect(files.getByRole('button', { name: 'Open Findings.txt' })).toHaveCount(1);
    await files.getByRole('button', { name: 'Open Findings.txt' }).click();
    await expect(files.getByRole('complementary', { name: 'File preview' })).toContainText('The retained research sample');
});

test.describe('Files touch selection', () => {
    test.use({ hasTouch: true });
    test('selects folders without opening them and exits selection mode', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await page.goto('/_tests/_test-storage');
        const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
        await createFolder(page, files, 'Files', 'Touch target');
        await files.getByRole('button', { name: 'Select', exact: true }).tap();
        await files.getByRole('button', { name: 'Touch target', exact: true }).tap();
        await expect(files.getByText('1 selected', { exact: true })).toBeVisible();
        await files.getByRole('button', { name: 'Done', exact: true }).tap();
        await files.getByRole('button', { name: 'Touch target', exact: true }).tap();
        await expect(files.getByRole('navigation', { name: 'Files location' })).toContainText('Touch target');
    });
});
