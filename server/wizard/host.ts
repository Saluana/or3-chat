/**
 * The setup wizard's own server: the prebuilt UI (shared/cloud/wizard/ui-build.ts)
 * and /api/wizard/*, on 127.0.0.1 behind a per-launch token. It runs inside
 * `bun run setup`; the Nuxt app does not serve the wizard. Nothing here watches
 * files, so writing the target's settings cannot restart it.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import {
    createApp,
    createError,
    createRouter,
    defineEventHandler,
    getCookie,
    getHeader,
    getRequestURL,
    readBody,
    sendRedirect,
    setCookie,
    setHeader,
    toNodeListener,
    type H3Event,
} from 'h3';
import type { WizardAnswers } from '../../shared/cloud/wizard/types';
import {
    assertWebWizardEnabled,
    configureWizardHost,
    getOrCreateWizardSession,
    getWizardClientToken,
    patchWizardSession,
    runWizardDeploy,
    scheduleWizardShutdown,
    setWizardNoStore,
    testWizardProviderConnection,
} from './index';

const TOKEN_COOKIE = 'or3_wizard_token';
const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
};

function requireSessionId(value: unknown): string {
    const sessionId = typeof value === 'string' ? value.trim() : '';
    if (!sessionId) {
        throw createError({ statusCode: 400, statusMessage: 'sessionId is required.' });
    }
    return sessionId;
}

/**
 * Every path except the health probe needs the token: from `?token=` on the
 * first visit (then a loopback cookie), the `x-wizard-token` header, or the
 * cookie. Opening /wizard?token=… drops the token from the address bar.
 */
function guardToken(event: H3Event, token: string): unknown {
    const url = getRequestURL(event);
    if (url.pathname === '/api/health') return;

    const remember = () =>
        setCookie(event, TOKEN_COOKIE, token, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 60 * 60,
        });

    if (url.searchParams.get('token')?.trim() === token) {
        remember();
        if (url.pathname === '/wizard') {
            url.searchParams.delete('token');
            return sendRedirect(event, `${url.pathname}${url.search}`, 302);
        }
        return;
    }
    const headerToken = String(getHeader(event, 'x-wizard-token') ?? '').trim();
    const cookieToken = String(getCookie(event, TOKEN_COOKIE) ?? '').trim();
    if (headerToken === token || cookieToken === token) {
        remember();
        return;
    }
    throw createError({ statusCode: 403, statusMessage: 'Invalid wizard token.' });
}

async function serveFile(event: H3Event, uiDir: string, relativePath: string) {
    const path = normalize(join(uiDir, relativePath));
    if (!path.startsWith(uiDir + sep)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    const contents = await readFile(path).catch(() => null);
    if (!contents) throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    setHeader(event, 'Content-Type', CONTENT_TYPES[extname(path)] ?? 'application/octet-stream');
    // Asset names are content-hashed; the page itself always revalidates.
    setHeader(event, 'Cache-Control', relativePath.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
    return contents;
}

export function createWizardHostApp(input: { token: string; uiDir: string }) {
    const uiDir = normalize(input.uiDir);
    const app = createApp();
    const router = createRouter();

    app.use(defineEventHandler((event) => guardToken(event, input.token)));

    router.get('/api/health', defineEventHandler(() => ({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    })));

    router.get('/api/wizard/session', defineEventHandler(async (event) => {
        assertWebWizardEnabled(event);
        setWizardNoStore(event);
        return {
            session: await getOrCreateWizardSession(event),
            wizardToken: getWizardClientToken(event),
        };
    }));

    router.patch('/api/wizard/session', defineEventHandler(async (event) => {
        assertWebWizardEnabled(event);
        setWizardNoStore(event);
        const body = await readBody<{ sessionId?: string; patch?: Partial<WizardAnswers> }>(event);
        const session = await patchWizardSession({
            sessionId: requireSessionId(body.sessionId),
            patch: body.patch ?? {},
        });
        return { session };
    }));

    router.post('/api/wizard/deploy', defineEventHandler(async (event) => {
        assertWebWizardEnabled(event);
        setWizardNoStore(event);
        const body = await readBody<{
            sessionId?: string;
            dryRun?: boolean;
            createBackup?: boolean;
            strict?: boolean;
            skipDeploy?: boolean;
            installDependencies?: boolean;
            packageManager?: string;
        }>(event);
        const result = await runWizardDeploy(requireSessionId(body.sessionId), {
            dryRun: body.dryRun,
            createBackup: body.createBackup,
            strict: body.strict,
            skipDeploy: body.skipDeploy,
            installDependencies: body.installDependencies,
            packageManager: body.packageManager,
        });
        if (!result.ok) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Wizard validation failed.',
                data: result,
            });
        }
        return result;
    }));

    router.post('/api/wizard/test-connection', defineEventHandler(async (event) => {
        assertWebWizardEnabled(event);
        setWizardNoStore(event);
        const body = await readBody<{ providerId?: string; credentials?: Record<string, string> }>(event);
        const providerId = body.providerId?.trim() ?? '';
        if (!providerId) {
            throw createError({ statusCode: 400, statusMessage: 'providerId is required.' });
        }
        return {
            result: await testWizardProviderConnection({
                providerId,
                credentials: body.credentials ?? {},
            }),
        };
    }));

    router.post('/api/wizard/shutdown', defineEventHandler((event) => {
        assertWebWizardEnabled(event);
        setWizardNoStore(event);
        scheduleWizardShutdown(350);
        return { ok: true };
    }));

    router.get('/', defineEventHandler((event) => sendRedirect(event, '/wizard', 302)));
    router.get('/favicon.ico', defineEventHandler(() => null));
    router.get('/wizard', defineEventHandler((event) => serveFile(event, uiDir, 'index.html')));
    router.get('/assets/**', defineEventHandler((event) =>
        serveFile(event, uiDir, getRequestURL(event).pathname.slice(1))));

    app.use(router);
    return app;
}

/** Starts the wizard on 127.0.0.1:`port` (0 picks one); `closed` settles when it stops. */
export async function startWizardHost(input: { port: number; token: string; uiDir: string }) {
    const server = createServer(toNodeListener(createWizardHostApp(input)));
    const close = () => {
        configureWizardHost(null);
        server.close();
        server.closeAllConnections();
    };
    configureWizardHost({ token: input.token, onShutdown: close });
    const closed = new Promise<void>((resolveClosed) => server.once('close', () => resolveClosed()));
    await new Promise<void>((resolveListening, rejectListening) => {
        server.once('error', rejectListening);
        server.listen(input.port, '127.0.0.1', () => resolveListening());
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : input.port;
    return { port, close, closed };
}
