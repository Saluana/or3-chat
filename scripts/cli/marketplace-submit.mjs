#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ORIGIN = 'https://staging.marketplace.or3.chat';
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const CLIENT_ID = 'or3-marketplace-cli';
const sdkCli = resolve(import.meta.dirname, '../../packages/plugin-sdk/bin/or3-plugin.mjs');

/** Small authenticated HTTP client shared by CLI commands and local contract tests. */
export function createMarketplaceRequest(extraHTTPHeaders = {}) {
    async function send(url, options = {}) {
        const response = await fetch(url, {
            method: options.method ?? 'GET',
            headers: { ...extraHTTPHeaders, ...options.headers },
            ...(options.data === undefined ? {} : { body: options.data }),
            signal: AbortSignal.timeout(options.timeout ?? 30_000),
        });
        return {
            ok: () => response.ok,
            status: () => response.status,
            text: () => response.text(),
        };
    }
    return {
        fetch: send,
        put: (url, options) => send(url, { ...options, method: 'PUT' }),
        dispose: async () => {},
    };
}

function usage() {
    return `Usage:
  or3-marketplace login [--device] [--no-browser]
  or3-marketplace <candidate-dir> --source <plugin-root> --listing <listing.json>
  or3-marketplace --trusted-package <package.zip> --source-archive <source.zip> --source <plugin-root> --listing <listing.json>
  or3-marketplace --resume <submission-id> --listing <listing.json>
  or3-marketplace logout

Options:
  --origin <url>   Marketplace origin (default: ${DEFAULT_ORIGIN})
  --draft          Save a draft without opening the review page
  --device         Use a device code for SSH or headless terminals
  --no-browser     Print the sign-in URL instead of opening it

Login opens your default browser with PKCE. Use --device for a remote shell.
CLI credentials are stored in a file readable only by your account.
The CLI prepares a draft; final submission for review is completed in your browser.
Trusted package uploads require an exact source archive and receive no candidate receipt.
`;
}

function sessionPath(origin) {
    const base = resolve(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'));
    const hash = createHash('sha256').update(origin).digest('hex').slice(0, 16);
    return join(base, 'or3-marketplace', `session-${hash}.json`);
}

async function saveSession(credentials, origin) {
    const path = sessionPath(origin);
    const directory = resolve(path, '..');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${path}.${process.pid}.tmp`;
    try {
        await writeFile(temporary, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 });
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true });
    }
}

async function oauthRequest(origin, path, body) {
    const response = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': path === '/api/v1/oauth/token' ?
            'application/x-www-form-urlencoded' : 'application/json' },
        body: path === '/api/v1/oauth/token' ? new URLSearchParams(body) : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const code = data?.data?.error?.code ?? data?.statusMessage ?? data?.error ?? 'oauth_error';
        const error = new Error(data?.data?.error?.message ?? data?.message ?? code);
        error.code = code;
        throw error;
    }
    return data;
}

function openDefaultBrowser(url, noBrowser) {
    process.stdout.write(`Open this URL in your browser: ${url}\n`);
    if (noBrowser) return;
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => process.stderr.write('Could not open the browser automatically. Use the URL above.\n'));
    child.unref();
}

function callbackListener() {
    let finish;
    let fail;
    const callback = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    let expectedState;
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
        if (url.searchParams.get('state') !== expectedState) {
            res.writeHead(400, { 'content-type': 'text/plain' }).end('Invalid login state. Return to your terminal.');
            return;
        }
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        if (!code || error) {
            res.writeHead(400, { 'content-type': 'text/plain' }).end('Marketplace login was cancelled.');
            fail(new Error(error || 'Marketplace login was cancelled.'));
            return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' }).end('Marketplace CLI sign-in complete. You may close this tab.');
        finish(code);
    });
    return {
        async listen(state) {
            expectedState = state;
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            return `http://127.0.0.1:${server.address().port}/callback`;
        },
        callback,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

async function browserLogin(origin, noBrowser) {
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const listener = callbackListener();
    const redirectUri = await listener.listen(state);
    let timeout;
    try {
        const grant = await oauthRequest(origin, '/api/v1/oauth/authorize', {
            client_id: CLIENT_ID, response_type: 'code', redirect_uri: redirectUri,
            code_challenge: challenge, code_challenge_method: 'S256', state,
        });
        if (typeof grant.id !== 'string') throw new Error('Marketplace did not start CLI login.');
        openDefaultBrowser(`${origin}/oauth/authorize?request=${encodeURIComponent(grant.id)}`, noBrowser);
        process.stdout.write('Waiting for browser authorization…\n');
        const code = await Promise.race([
            listener.callback,
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Login timed out after five minutes.')), 300_000); }),
        ]);
        return oauthRequest(origin, '/api/v1/oauth/token', {
            grant_type: 'authorization_code', client_id: CLIENT_ID,
            code, redirect_uri: redirectUri, code_verifier: verifier,
        });
    } finally { clearTimeout(timeout); await listener.close(); }
}

async function deviceLogin(origin, noBrowser) {
    const grant = await oauthRequest(origin, '/api/v1/oauth/device/code', { client_id: CLIENT_ID });
    if (!grant.device_code || !grant.user_code || !grant.verification_uri) {
        throw new Error('Marketplace did not return a device login code.');
    }
    process.stdout.write(`Enter code: ${grant.user_code}\n`);
    openDefaultBrowser(grant.verification_uri_complete || grant.verification_uri, noBrowser);
    let interval = Math.max(1, Number(grant.interval) || 5) * 1000;
    const deadline = Date.now() + Math.min(900, Number(grant.expires_in) || 600) * 1000;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        try {
            return await oauthRequest(origin, '/api/v1/oauth/token', {
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                client_id: CLIENT_ID, device_code: grant.device_code,
            });
        } catch (error) {
            if (error.code === 'authorization_pending') continue;
            if (error.code === 'slow_down') { interval += 5000; continue; }
            throw error;
        }
    }
    throw new Error('Device login expired. Run or3-marketplace login --device again.');
}

async function login(origin, { device, noBrowser }) {
    const token = device ? await deviceLogin(origin, noBrowser) : await browserLogin(origin, noBrowser);
    if (!token.access_token || !token.refresh_token || token.token_type !== 'Bearer') {
        throw new Error('Marketplace returned an incomplete CLI login.');
    }
    let old;
    try { old = JSON.parse(await readFile(sessionPath(origin), 'utf8')); }
    catch { /* no previous CLI login */ }
    if (old?.refreshToken) {
        try {
            await oauthRequest(origin, '/api/v1/oauth/revoke', {
                client_id: CLIENT_ID, refresh_token: old.refreshToken,
            });
        } catch {
            process.stderr.write('Previous CLI login could not be revoked.\n');
        }
    }
    await saveSession({ accessToken: token.access_token, refreshToken: token.refresh_token,
        expiresAt: Date.now() + token.expires_in * 1000 }, origin);
    const api = createMarketplaceRequest({ authorization: `Bearer ${token.access_token}` });
    try {
        const profile = await apiJson(api, origin, 'GET', '/api/v1/developer/profile');
        process.stdout.write(profile?.namespace
            ? `Signed in as ${profile.namespace}.\n`
            : 'Signed in. Create a developer profile in the marketplace before uploading.\n');
    } finally { await api.dispose(); }
}

async function activeSession(origin) {
    let credentials;
    try { credentials = JSON.parse(await readFile(sessionPath(origin), 'utf8')); }
    catch { throw new Error('Sign in first with or3-marketplace login.'); }
    if (!credentials.accessToken || !credentials.refreshToken) throw new Error('CLI login is invalid. Run or3-marketplace login.');
    if (Date.now() >= credentials.expiresAt - 30_000) {
        let token;
        try {
            token = await oauthRequest(origin, '/api/v1/oauth/token', {
                grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: credentials.refreshToken,
            });
        } catch { throw new Error('CLI login expired or was revoked. Run or3-marketplace login.'); }
        credentials = { accessToken: token.access_token, refreshToken: token.refresh_token,
            expiresAt: Date.now() + token.expires_in * 1000 };
        await saveSession(credentials, origin);
    }
    return credentials;
}

function option(args, name) {
    const index = args.indexOf(name);
    if (index < 0) return null;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} needs a value`);
    return args[index + 1];
}

function marketplaceOrigin(value) {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) {
        throw new Error('Marketplace origin must be HTTPS (or loopback HTTP for local development).');
    }
    return url.origin;
}

async function apiJson(request, origin, method, path, body) {
    const response = await request.fetch(`${origin}${path}`, {
        method,
        headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { data: JSON.stringify(body) }),
        timeout: 30_000,
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!response.ok()) {
        const details = data?.data?.error ?? data?.error;
        const error = new Error(details?.message ?? data?.message ?? `Marketplace request failed (${response.status()})`);
        error.status = response.status();
        error.code = details?.code ?? data?.statusMessage;
        error.action = details?.action;
        throw error;
    }
    return data;
}

async function uploadOne(request, origin, kind, path) {
    const size = (await stat(path)).size;
    if (size < 1 || size > MAX_ARCHIVE_BYTES) throw new Error(`${kind} archive must be between 1 byte and 32 MiB`);
    const reservation = await apiJson(request, origin, 'POST', '/api/v1/developer/uploads', { kind, bytes: size });
    if (typeof reservation?.id !== 'string') throw new Error(`Marketplace did not reserve the ${kind} upload`);
    const upload = await request.put(`${origin}/api/v1/developer/uploads/${encodeURIComponent(reservation.id)}`, {
        headers: { origin, 'content-type': 'application/octet-stream' },
        data: await readFile(path),
        timeout: 120_000,
    });
    if (!upload.ok()) {
        const raw = await upload.text();
        let message;
        try {
            const data = JSON.parse(raw);
            message = (data?.data?.error ?? data?.error)?.message ?? data?.message;
        } catch { /* use status */ }
        throw new Error(message ?? `${kind} upload failed (${upload.status()})`);
    }
    const finalized = await apiJson(request, origin, 'POST',
        `/api/v1/developer/uploads/${encodeURIComponent(reservation.id)}/finalize`);
    if (typeof finalized?.reservationId !== 'string') throw new Error(`${kind} upload was not finalized`);
    return finalized.reservationId;
}

async function finishDraft({ request, origin, id, listing, submit }) {
    const path = `/api/v1/developer/submissions/${encodeURIComponent(id)}`;
    let detail = await apiJson(request, origin, 'GET', path);
    if (detail.status === 'uploaded') {
        return { id, status: 'uploaded', blockers: [], url: `${origin}/developer/submissions/${encodeURIComponent(id)}` };
    }
    if (listing) {
        const { name, summary, ...metadata } = listing;
        await apiJson(request, origin, 'PATCH', path, {
            ...(name === undefined ? {} : { name }),
            ...(summary === undefined ? {} : { summary }),
            listing: metadata,
        });
    }
    detail = await apiJson(request, origin, 'GET', path);
    const blockers = (detail.checklist ?? [])
        .filter((item) => item.severity === 'blocker' && !item.satisfied)
        .map((item) => item.detail || item.label);
    if (!submit || !detail.submittable || blockers.length) {
        return { id, status: detail.status, blockers, url: `${origin}/developer/submissions/${encodeURIComponent(id)}` };
    }
    const submitted = await apiJson(request, origin, 'POST', `${path}/submit`);
    if (submitted?.status !== 'uploaded') throw new Error('Marketplace did not confirm submission for review');
    return { id, status: submitted.status, blockers: [], url: `${origin}/developer/submissions/${encodeURIComponent(id)}` };
}

/** Upload the three immutable candidate files through an authenticated API request. */
export async function submitCandidate({ request, origin, candidateDirectory, listing, submit = true }) {
    const directory = resolve(candidateDirectory);
    const packageReservationId = await uploadOne(request, origin, 'package', join(directory, 'package.zip'));
    const sourceReservationId = await uploadOne(request, origin, 'source', join(directory, 'source.zip'));
    const draft = await apiJson(request, origin, 'POST', '/api/v1/developer/submissions', {
        packageReservationId, sourceReservationId,
    });
    if (typeof draft?.id !== 'string') throw new Error('Marketplace did not return a draft ID');
    const id = draft.id;
    try {
        const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
        await apiJson(request, origin, 'POST', `/api/v1/developer/submissions/${encodeURIComponent(id)}/receipt`, { receipt });
        return await finishDraft({ request, origin, id, listing, submit });
    } catch (error) {
        error.draftUrl = `${origin}/developer/submissions/${encodeURIComponent(id)}`;
        error.draftId = id;
        throw error;
    }
}

/** Upload a trusted-host package and its source without claiming portable candidate qualification. */
export async function submitTrustedArchive({ request, origin, packagePath, sourcePath, listing }) {
    const packageReservationId = await uploadOne(request, origin, 'package', resolve(packagePath));
    const sourceReservationId = await uploadOne(request, origin, 'source', resolve(sourcePath));
    const draft = await apiJson(request, origin, 'POST', '/api/v1/developer/submissions', {
        packageReservationId, sourceReservationId,
    });
    if (typeof draft?.id !== 'string') throw new Error('Marketplace did not return a draft ID');
    try {
        return await finishDraft({ request, origin, id: draft.id, listing, submit: false });
    } catch (error) {
        error.draftUrl = `${origin}/developer/submissions/${encodeURIComponent(draft.id)}`;
        error.draftId = draft.id;
        throw error;
    }
}

function runSdk(args) {
    const result = spawnSync('bun', [sdkCli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error || result.status !== 0) {
        throw new Error(`Candidate check failed: ${(result.stderr || result.stdout || result.error?.message || '').trim()}`);
    }
}

async function main(argv) {
    if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(usage()); return; }
    const command = ['login', 'logout'].includes(argv[0]) ? argv[0] : null;
    const args = command ? argv.slice(1) : argv;
    const origin = marketplaceOrigin(option(args, '--origin') ?? DEFAULT_ORIGIN);
    if (command === 'login') { await login(origin, { device: args.includes('--device') || Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY), noBrowser: args.includes('--no-browser') }); return; }
    if (command === 'logout') {
        let credentials;
        try { credentials = JSON.parse(await readFile(sessionPath(origin), 'utf8')); }
        catch { /* already signed out locally */ }
        try {
            if (credentials?.refreshToken) {
                await oauthRequest(origin, '/api/v1/oauth/revoke', { client_id: CLIENT_ID, refresh_token: credentials.refreshToken });
            }
        } catch {
            throw new Error('Could not confirm remote logout. Credentials were kept so you can retry.');
        }
        await rm(sessionPath(origin), { force: true });
        process.stdout.write('Signed out of the marketplace CLI.\n');
        return;
    }
    const resumeId = option(args, '--resume');
    const trustedPackagePath = option(args, '--trusted-package');
    const sourceArchivePath = option(args, '--source-archive');
    const candidateDirectory = args[0]?.startsWith('--') ? null : args[0];
    const sourceRoot = option(args, '--source');
    const listingPath = option(args, '--listing');
    const submit = !args.includes('--draft');
    if (!listingPath || (!resumeId && !sourceRoot) ||
        (!resumeId && !trustedPackagePath && !candidateDirectory) ||
        (trustedPackagePath && (!sourceArchivePath || candidateDirectory)) ||
        (!trustedPackagePath && sourceArchivePath)) {
        throw new Error(`A candidate or trusted package, its source, and --listing are required.\n${usage()}`);
    }
    const credentials = await activeSession(origin);
    const listing = JSON.parse(await readFile(resolve(listingPath), 'utf8'));
    if (!listing || typeof listing !== 'object' || Array.isArray(listing)) throw new Error('Listing must be a JSON object');
    let receipt;
    if (trustedPackagePath) {
        runSdk(['validate', resolve(sourceRoot)]);
        const manifest = JSON.parse(await readFile(join(resolve(sourceRoot), 'or3.manifest.json'), 'utf8'));
        if (manifest.trust !== 'trusted-host' || manifest.runtime?.client?.isolation !== 'host') {
            throw new Error('--trusted-package requires a trusted-host source manifest');
        }
        process.stdout.write(`Uploading trusted-host ${manifest.id} ${manifest.version}; reviewer qualification is still required…\n`);
    } else if (!resumeId) {
        const directory = resolve(candidateDirectory);
        runSdk(['candidate', '--verify', directory]);
        runSdk(['candidate', '--qualify', resolve(sourceRoot), '--candidate', directory]);
        receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
        if (receipt?.source?.dirty !== false) throw new Error('Candidate source is dirty; create a clean candidate');
        process.stdout.write(`Qualified ${receipt.pluginId} ${receipt.version}. Connecting to marketplace…\n`);
    }
    const api = createMarketplaceRequest({ authorization: `Bearer ${credentials.accessToken}` });
    try {
        let publisher;
        try { publisher = await apiJson(api, origin, 'GET', '/api/v1/developer/profile'); }
        catch (error) {
            if (error.status === 401) throw new Error('CLI login expired. Run or3-marketplace login again.');
            throw error;
        }
        if (!publisher?.namespace) throw new Error('Create a developer profile with or3-marketplace login first.');
        if (submit && (publisher.status !== 'active' || !publisher.submissionEnabled)) {
            throw new Error('Your developer profile is not enabled for submissions yet. Check Submission eligibility in the browser.');
        }
        if (receipt && !receipt.pluginId.startsWith(`${publisher.namespace}.`)) {
            throw new Error(`Plugin ID ${receipt.pluginId} must start with your developer namespace ${publisher.namespace}.`);
        }
        const action = resumeId
            ? () => finishDraft({ request: api, origin, id: resumeId, listing, submit: false })
            : trustedPackagePath
                ? () => submitTrustedArchive({ request: api, origin, packagePath: trustedPackagePath, sourcePath: sourceArchivePath, listing })
                : () => submitCandidate({ request: api, origin, candidateDirectory, listing, submit: false });
        let result;
        try { result = await action(); }
        catch (error) {
            if (error.draftUrl) process.stderr.write(`Draft retained: ${error.draftUrl}\n`);
            throw error;
        }
        process.stdout.write(`${result.status === 'uploaded' ? 'Submitted for review' : 'Draft saved'}: ${result.url}\n`);
        if (submit && result.status !== 'uploaded' && !result.blockers.length) {
            process.stdout.write('Open this page to complete recent account verification and click Submit for review.\n');
            openDefaultBrowser(result.url, args.includes('--no-browser'));
        }
        if (result.blockers.length) {
            process.stdout.write(`Marketplace blockers:\n${result.blockers.map((item) => `  - ${item}`).join('\n')}\n`);
            process.stdout.write(`After fixing the listing, run again with --resume ${result.id} --listing <file>.\n`);
            process.exitCode = 2;
        }
    } finally {
        await api.dispose();
    }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
