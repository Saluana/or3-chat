import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startWizardHost } from '../host';

const TOKEN = 'expected-token';

describe('wizard host', () => {
    let parent: string;
    let uiDir: string;
    let host: Awaited<ReturnType<typeof startWizardHost>>;
    let base: string;

    beforeEach(async () => {
        parent = await mkdtemp(join(tmpdir(), 'or3-wizard-host-'));
        uiDir = join(parent, 'ui');
        await mkdir(join(uiDir, 'assets'), { recursive: true });
        await writeFile(join(uiDir, 'index.html'), '<div id="app"></div>');
        await writeFile(join(uiDir, 'assets/app.js'), 'export {}');
        await writeFile(join(parent, 'secret.txt'), 'outside the UI');
        host = await startWizardHost({ port: 0, token: TOKEN, uiDir });
        base = `http://127.0.0.1:${host.port}`;
    });

    afterEach(async () => {
        host.close();
        await host.closed;
        await rm(parent, { recursive: true, force: true });
    });

    it('refuses the page, assets and API without the token', async () => {
        for (const path of ['/wizard', '/assets/app.js', '/api/wizard/session']) {
            expect((await fetch(base + path, { redirect: 'manual' })).status).toBe(403);
        }
        const wrong = await fetch(`${base}/api/wizard/session`, { headers: { 'x-wizard-token': 'wrong' } });
        expect(wrong.status).toBe(403);
        expect((await fetch(`${base}/api/health`)).status).toBe(200);
    });

    it('trades the link token for a loopback cookie and drops it from the address', async () => {
        const opened = await fetch(`${base}/wizard?token=${TOKEN}&instanceDir=%2Fopt%2For3`, { redirect: 'manual' });
        expect(opened.status).toBe(302);
        expect(opened.headers.get('location')).toBe('/wizard?instanceDir=%2Fopt%2For3');
        const cookie = opened.headers.get('set-cookie') ?? '';
        expect(cookie).toMatch(/or3_wizard_token=expected-token/);
        expect(cookie).toMatch(/HttpOnly/i);

        const headers = { cookie: cookie.split(';')[0]! };
        const page = await fetch(`${base}/wizard`, { headers });
        expect(page.status).toBe(200);
        expect(await page.text()).toContain('id="app"');
        expect((await fetch(`${base}/assets/app.js`, { headers })).status).toBe(200);
        expect((await fetch(`${base}/assets/..%2F..%2Fsecret.txt`, { headers })).status).toBe(404);
    });

    it('stops when setup hands off to the app', async () => {
        const response = await fetch(`${base}/api/wizard/shutdown`, {
            method: 'POST',
            headers: { 'x-wizard-token': TOKEN },
        });
        expect(response.status).toBe(200);
        await expect(host.closed).resolves.toBeUndefined();
    });
});
