import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMarketplaceRequest, submitCandidate, submitTrustedArchive } from '../cli/marketplace-submit.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'or3-marketplace-cli-test-'));
after(() => rm(temporary, { recursive: true, force: true }));

test('marketplace help runs without development dependencies installed', async () => {
    const executable = join(temporary, 'marketplace-submit.mjs');
    await copyFile(fileURLToPath(new URL('../cli/marketplace-submit.mjs', import.meta.url)), executable);
    const result = spawnSync('bun', [executable, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /or3-marketplace login/);
});

async function candidate(name) {
    const directory = join(temporary, name);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(directory);
    await writeFile(join(directory, 'package.zip'), Buffer.from('exact-package-bytes'));
    await writeFile(join(directory, 'source.zip'), Buffer.from('exact-source-bytes'));
    await writeFile(join(directory, 'receipt.json'), JSON.stringify({ pluginId: 'or3.example', version: '1.0.0' }));
    return directory;
}

async function withMarketplace(submittable, run, submitError = false) {
    const seen = [];
    const server = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const path = new URL(req.url, 'http://localhost').pathname;
        seen.push({ method: req.method, path, body, origin: req.headers.origin, cookie: req.headers.cookie });
        let response;
        if (req.method === 'POST' && path === '/api/v1/developer/uploads') {
            const kind = JSON.parse(body.toString()).kind;
            response = { id: `${kind}-upload` };
        } else if (req.method === 'PUT' && path.endsWith('-upload')) {
            response = { reservation: { id: path.split('/').at(-1) } };
        } else if (req.method === 'POST' && path.endsWith('/finalize')) {
            response = { reservationId: path.split('/').at(-2) };
        } else if (req.method === 'POST' && path === '/api/v1/developer/submissions') {
            response = { id: 'sub_example' };
        } else if (req.method === 'POST' && path.endsWith('/receipt')) {
            response = { receiptSha256: 'sha256-test' };
        } else if (req.method === 'PATCH' && path.endsWith('/sub_example')) {
            response = { id: 'sub_example' };
        } else if (req.method === 'GET' && path.endsWith('/sub_example')) {
            response = { id: 'sub_example', status: 'draft', submittable, checklist: submittable ? [] : [
                { id: 'support-privacy', severity: 'blocker', satisfied: false, detail: 'Add support and privacy links.' },
            ] };
        } else if (req.method === 'POST' && path.endsWith('/submit')) {
            if (submitError) {
                const body = submitError === 'flat'
                    ? { statusCode: 403, statusMessage: 'recent-verification-required', message: 'Verify again.' }
                    : { statusCode: 403,
                        data: { error: { code: 'recent-mfa-required', message: 'Verify again.', action: 'reverify' } } };
                res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify(body));
                return;
            }
            response = { id: 'sub_example', status: 'uploaded' };
        } else {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const api = createMarketplaceRequest({ cookie: 'session=valid' });
    try { return await run({ api, origin, seen }); }
    finally { await api.dispose(); await new Promise((resolve) => server.close(resolve)); }
}

test('uploads the exact candidate bytes, attaches its receipt, saves listing, and submits', async () => {
    const directory = await candidate('valid');
    await withMarketplace(true, async ({ api, origin, seen }) => {
        const result = await submitCandidate({
            request: api, origin, candidateDirectory: directory,
            listing: { category: 'automation', tags: [], supportUrl: 'https://example.com/support', privacyUrl: 'https://example.com/privacy' },
            submit: true,
        });
        assert.equal(result.id, 'sub_example');
        assert.equal(result.status, 'uploaded');
        assert.deepEqual(seen.filter((call) => call.method === 'PUT').map((call) => call.body.toString()), [
            'exact-package-bytes', 'exact-source-bytes',
        ]);
        assert.deepEqual(JSON.parse(seen.find((call) => call.path.endsWith('/receipt')).body.toString()).receipt,
            { pluginId: 'or3.example', version: '1.0.0' });
        assert.equal(seen.at(-1).path, '/api/v1/developer/submissions/sub_example/submit');
        assert.ok(seen.every((call) => call.origin === origin && call.cookie === 'session=valid'));
    });
});

test('uploads trusted package and source archives without inventing a candidate receipt', async () => {
    const directory = await candidate('trusted');
    await withMarketplace(true, async ({ api, origin, seen }) => {
        const result = await submitTrustedArchive({
            request: api, origin,
            packagePath: join(directory, 'package.zip'), sourcePath: join(directory, 'source.zip'),
            listing: { category: 'automation', tags: [], supportUrl: 'https://example.com/support', privacyUrl: 'https://example.com/privacy' },
        });
        assert.equal(result.status, 'draft');
        assert.deepEqual(seen.filter((call) => call.method === 'PUT').map((call) => call.body.toString()), [
            'exact-package-bytes', 'exact-source-bytes',
        ]);
        assert.equal(seen.some((call) => call.path.endsWith('/receipt')), false);
        assert.equal(seen.some((call) => call.path.endsWith('/submit')), false);
    });
});

test('leaves a blocked draft in place without submitting it', async () => {
    const directory = await candidate('blocked');
    await withMarketplace(false, async ({ api, origin, seen }) => {
        const result = await submitCandidate({ request: api, origin, candidateDirectory: directory,
            listing: { category: 'automation', tags: [] }, submit: true });
        assert.equal(result.status, 'draft');
        assert.deepEqual(result.blockers, ['Add support and privacy links.']);
        assert.equal(seen.some((call) => call.path.endsWith('/submit')), false);
    });
});

test('retains the draft and exposes marketplace re-verification errors', async () => {
    const directory = await candidate('mfa');
    await withMarketplace(true, async ({ api, origin }) => {
        await assert.rejects(
            submitCandidate({ request: api, origin, candidateDirectory: directory, listing: { category: 'automation' } }),
            (error) => error.code === 'recent-mfa-required' && error.action === 'reverify' &&
                error.draftId === 'sub_example' && error.message === 'Verify again.',
        );
    }, true);
});

test('recognizes the deployed marketplace flat error response', async () => {
    const directory = await candidate('flat-mfa');
    await withMarketplace(true, async ({ api, origin }) => {
        await assert.rejects(
            submitCandidate({ request: api, origin, candidateDirectory: directory, listing: { category: 'automation' } }),
            (error) => error.code === 'recent-verification-required' && error.message === 'Verify again.' &&
                error.draftId === 'sub_example',
        );
    }, 'flat');
});
