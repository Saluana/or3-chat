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

async function dragRow(page: Page, from: Locator, to: Locator) {
    await from.scrollIntoViewIfNeeded();
    await to.scrollIntoViewIfNeeded();
    const source = await from.locator('[data-explorer-drag-handle]').boundingBox();
    if (!source) throw new Error('Missing visible drag source.');
    const x = source.x + source.width / 2;
    const y = source.y + source.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y, { steps: 3 });
    await expect(page.getByRole('region', { name: 'Workspace Files', exact: true }))
        .toHaveAttribute('data-explorer-dragging', 'true');
    const target = await to.boundingBox();
    if (!target) throw new Error('Missing visible drag destination.');
    const endX = target.x + target.width / 2;
    const endY = target.y + target.height / 2;
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.move(endX + 1, endY + 1);
    await expect(to).toHaveAttribute('data-explorer-drop', 'true');
    await page.mouse.up();
}

test('organizes actual Files through selection, drag, breadcrumbs and Move to', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/_tests/_test-storage');
    const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
    const breadcrumbs = files.getByRole('navigation', { name: 'Files location' });
    await createFolder(page, files, 'Files', 'Research');
    await upload(files, 'alpha.txt', 'Alpha original content');
    await upload(files, 'beta.txt', 'Beta original content');
    const alpha = files.getByRole('button', { name: 'Open alpha.txt', exact: true });
    const beta = files.getByRole('button', { name: 'Open beta.txt', exact: true });
    await alpha.click({ modifiers: ['Control'] });
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

    await alpha.click({ modifiers: ['Control'] });
    await files.getByRole('button', { name: 'Move 1 item to Trash' }).click();
    const trashDialog = page.getByRole('dialog', { name: 'Move 1 item to Trash' });
    await trashDialog.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await expect(trashDialog).toBeHidden();
    await expect(alpha).toBeHidden();
    await files.getByRole('button', { name: 'Trash', exact: true }).click();
    await files.getByRole('button', { name: 'Restore', exact: true }).click();
    await files.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(alpha).toBeVisible();

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


test('Project Home opens its explorer and creates a document in a folder', async ({ page }, info) => {
    await page.goto('/chat');
    await expect(page.getByRole('textbox', { name: 'Message input' }).first()).toBeVisible({ timeout: 45_000 });
    const dismiss = page.getByRole('button', { name: 'Dismiss welcome' });
    if (await dismiss.isVisible()) await dismiss.click();
    const navigation = page.getByRole('complementary', { name: 'Navigation' });
    await navigation.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'New project', exact: true }).click();
    const projectDialog = page.getByRole('dialog', { name: 'New Project', exact: true });
    await projectDialog.getByPlaceholder('Project title').fill('Test Library');
    await projectDialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(projects.getByRole('heading', { name: 'Test Library', exact: true })).toBeVisible();
    await expect(projects.getByRole('button', { name: 'Recent activity', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await projects.getByRole('button', { name: 'Explorer', exact: true }).click();
    const explorer = projects.getByRole('region', { name: 'Project Explorer' });
    await createFolder(page, explorer, 'Test Library', 'Notes');
    await explorer.getByRole('button', { name: 'More actions for Notes' }).click();
    await page.getByRole('menuitem', { name: 'New document in Notes' }).click();
    await expect(page.getByRole('textbox', { name: 'Document title' })).toBeVisible();
    await explorer.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(explorer.getByRole('button', { name: 'Untitled', exact: true })).toBeVisible();
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

test('virtualizes a complete Files selection at the planned fixture size', async ({ page }, info) => {
    await page.goto('/_tests/_test-storage');
    const files = page.getByRole('region', { name: 'Workspace Files', exact: true });
    await expect(page.getByTestId('storage-ready')).toHaveText('true', { timeout: 30_000 });
    await page.getByTestId('seed-explorer-fixture').click();

    await expect(files.getByText('5481 items', { exact: true })).toBeVisible({ timeout: 30_000 });
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
    await row.click({ modifiers: ['Control'] });
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
    await notes.click({ modifiers: ['Control'] });
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
    await files.getByRole('textbox', { name: 'Search Files' }).press('Control+z');
    await expect(renamed).toBeVisible();
    await renamed.press('Control+z');
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
