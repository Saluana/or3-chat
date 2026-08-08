#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const phase = process.argv[2];
if (phase !== 'write' && phase !== 'verify') {
    throw new Error('Usage: smoke-create-docker.mjs write|verify');
}

const baseUrl = process.env.OR3_SMOKE_URL ?? 'http://127.0.0.1:3000';
const statePath = resolve('.or3-smoke-state.json');

function parseEnv(source) {
    const values = {};
    for (const rawLine of source.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1).replaceAll(/\\([\\'])/g, '$1');
        } else if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    return values;
}

async function responseError(response) {
    const body = await response.text().catch(() => '');
    return new Error(
        `${response.url} returned ${response.status}: ${body.slice(0, 300)}`
    );
}

async function expectOk(response) {
    if (!response.ok) throw await responseError(response);
    return response;
}

async function jsonRequest(path, { body, cookie, method = 'POST' } = {}) {
    const response = await fetch(new URL(path, baseUrl), {
        method,
        headers: {
            accept: 'application/json',
            ...(body === undefined
                ? {}
                : { 'content-type': 'application/json' }),
            ...(cookie ? { cookie } : {}),
            ...(method === 'GET' ? {} : { origin: baseUrl }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    await expectOk(response);
    return await response.json();
}

async function authenticate() {
    const env = parseEnv(await readFile(resolve('.env'), 'utf8'));
    const email = env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
    const password = env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD;
    if (!email || !password) {
        throw new Error('Basic Auth bootstrap credentials are missing from .env.');
    }

    const signIn = await fetch(new URL('/api/basic-auth/sign-in', baseUrl), {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            origin: baseUrl,
        },
        body: JSON.stringify({ email, password }),
    });
    await expectOk(signIn);
    const setCookies =
        typeof signIn.headers.getSetCookie === 'function'
            ? signIn.headers.getSetCookie()
            : [signIn.headers.get('set-cookie')].filter(Boolean);
    const cookie = setCookies
        .map((value) => value.split(';', 1)[0])
        .join('; ');
    if (!cookie) throw new Error('Basic Auth sign-in did not set a cookie.');

    const session = await jsonRequest('/api/auth/session', {
        cookie,
        method: 'GET',
    });
    if (
        session.session?.user?.email !== email ||
        !session.session?.workspace?.id
    ) {
        throw new Error('Authenticated session did not include the admin workspace.');
    }
    return {
        cookie,
        workspaceId: session.session.workspace.id,
    };
}

async function verifyAdminDashboard() {
    const env = parseEnv(await readFile(resolve('.env'), 'utf8'));
    const username = env.OR3_ADMIN_USERNAME;
    const password = env.OR3_ADMIN_PASSWORD;
    if (!username || !password) {
        throw new Error('Cloud smoke requires OR3_ADMIN_USERNAME and OR3_ADMIN_PASSWORD.');
    }

    const signIn = await fetch(new URL('/api/admin/auth/login', baseUrl), {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            origin: baseUrl,
        },
        body: JSON.stringify({ username, password }),
    });
    await expectOk(signIn);
    const setCookies =
        typeof signIn.headers.getSetCookie === 'function'
            ? signIn.headers.getSetCookie()
            : [signIn.headers.get('set-cookie')].filter(Boolean);
    const cookie = setCookies
        .map((value) => value.split(';', 1)[0])
        .join('; ');
    if (!cookie) throw new Error('Admin sign-in did not set a cookie.');

    const dashboard = await expectOk(
        await fetch(new URL('/admin', baseUrl), {
            headers: { cookie },
        })
    );
    const page = await dashboard.text();
    if (!page.includes('Admin')) {
        throw new Error('Admin dashboard did not render after sign-in.');
    }
}

async function verifySync(cookie, workspaceId) {
    const pull = await jsonRequest('/api/sync/pull', {
        cookie,
        body: {
            scope: { workspaceId },
            cursor: 0,
            limit: 10,
            tables: ['messages'],
        },
    });
    if (!Array.isArray(pull.changes) || typeof pull.nextCursor !== 'number') {
        throw new Error('SQLite sync pull returned an invalid response.');
    }
}

async function verifyCloudMode() {
    // The production lock page can be streamed/serialized differently across
    // Nuxt builds, so qualify the runtime contract through the public deep
    // health response rather than brittle HTML substring matching.
    const response = await expectOk(
        await fetch(new URL('/api/health?deep=true', baseUrl))
    );
    const health = await response.json();
    const providers = health.providers ?? {};
    if (
        health.status !== 'ok' ||
        providers.auth?.provider !== 'basic-auth' ||
        providers.sync?.provider !== 'sqlite' ||
        providers.storage?.provider !== 'fs'
    ) {
        throw new Error(
            `Managed Cloud provider profile is not active: ${JSON.stringify({
                status: health.status,
                providers: {
                    auth: providers.auth?.provider,
                    sync: providers.sync?.provider,
                    storage: providers.storage?.provider,
                },
            })}`
        );
    }
}

const uploadBytes = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
    'hex'
);

async function writeFixture(cookie, workspaceId) {
    const hash = createHash('sha256').update(uploadBytes).digest('hex');
    const qualifiedHash = `sha256:${hash}`;
    const presign = await jsonRequest('/api/storage/presign-upload', {
        cookie,
        body: {
            workspace_id: workspaceId,
            hash: qualifiedHash,
            mime_type: 'image/png',
            size_bytes: uploadBytes.length,
            disposition: 'inline',
        },
    });
    const upload = await fetch(new URL(presign.url, baseUrl), {
        method: presign.method ?? 'PUT',
        headers: {
            'content-type': 'image/png',
            ...(cookie ? { cookie } : {}),
            ...(presign.headers ?? {}),
        },
        body: uploadBytes,
    });
    await expectOk(upload);

    await jsonRequest('/api/storage/commit', {
        cookie,
        body: {
            workspace_id: workspaceId,
            hash: qualifiedHash,
            storage_id: presign.storageId,
            storage_provider_id: 'fs',
            mime_type: 'image/png',
            size_bytes: uploadBytes.length,
            name: 'or3-docker-smoke.png',
            kind: 'image',
        },
    });
    await writeFile(
        statePath,
        `${JSON.stringify(
            {
                workspaceId,
                hash: qualifiedHash,
                storageId: presign.storageId,
            },
            null,
            2
        )}\n`
    );
}

async function verifyFixture(cookie, workspaceId) {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    if (state.workspaceId !== workspaceId) {
        throw new Error('Workspace identity changed after container restart.');
    }
    const presign = await jsonRequest('/api/storage/presign-download', {
        cookie,
        body: {
            workspace_id: workspaceId,
            hash: state.hash,
            storage_id: state.storageId,
            mime_type: 'image/png',
            disposition: 'attachment',
        },
    });
    const download = await fetch(new URL(presign.url, baseUrl), {
        headers: cookie ? { cookie } : {},
    });
    await expectOk(download);
    const restored = Buffer.from(await download.arrayBuffer());
    if (!restored.equals(uploadBytes)) {
        throw new Error('Uploaded file did not survive the container restart.');
    }
}

const { cookie, workspaceId } = await authenticate();
await verifyCloudMode();
await verifyAdminDashboard();
await verifySync(cookie, workspaceId);
if (phase === 'write') {
    await writeFixture(cookie, workspaceId);
    console.log('Docker login, SQLite sync, and file upload smoke passed.');
} else {
    await verifyFixture(cookie, workspaceId);
    console.log('Docker authentication and file persistence smoke passed.');
}
