import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const env = process.env;

function firstDefined(...values) {
    return values.find((value) => value) ?? '';
}

function setDefault(name, value) {
    if (!Object.hasOwn(env, name)) env[name] = value;
}

// Nuxt can only override built runtimeConfig values through NUXT_* variables.
// Preserve OR3's documented environment contract for prebuilt containers by
// translating those values at process startup. Explicit NUXT_* values win.
const authEnabled = firstDefined(env.SSR_AUTH_ENABLED, 'false');
const authProvider = firstDefined(env.OR3_AUTH_PROVIDER, env.AUTH_PROVIDER, 'clerk');
const guestAccessEnabled = firstDefined(env.OR3_GUEST_ACCESS_ENABLED, 'false');
const registrationMode = firstDefined(env.OR3_AUTH_REGISTRATION_MODE, 'open');
const autoProvision = firstDefined(env.OR3_AUTH_AUTO_PROVISION, 'true');
const bootstrapEmail = firstDefined(env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL);
const inviteTokenSecret = firstDefined(env.OR3_AUTH_INVITE_TOKEN_SECRET);
const inviteTokenTtlSeconds = firstDefined(env.OR3_AUTH_INVITE_TOKEN_TTL_SECONDS, '604800');

const syncEnabled = firstDefined(env.OR3_CLOUD_SYNC_ENABLED, env.OR3_SYNC_ENABLED, 'false');
const syncProvider = firstDefined(env.OR3_SYNC_PROVIDER, 'convex');

const storageEnabled = firstDefined(env.OR3_CLOUD_STORAGE_ENABLED, env.OR3_STORAGE_ENABLED, 'false');
const storageProvider = firstDefined(env.OR3_STORAGE_PROVIDER, env.NUXT_PUBLIC_STORAGE_PROVIDER, 'convex');

const backgroundEnabled = firstDefined(env.OR3_BACKGROUND_STREAMING_ENABLED, 'false');
const backgroundProvider = firstDefined(
    env.OR3_BACKGROUND_STREAMING_PROVIDER,
    syncEnabled === 'true' ? syncProvider : 'memory'
);
const backgroundMaxJobs = firstDefined(env.OR3_BACKGROUND_MAX_JOBS, '20');
const backgroundMaxJobsPerUser = firstDefined(
    env.OR3_BACKGROUND_MAX_JOBS_PER_USER,
    '5'
);
const backgroundTimeoutSeconds = Number(
    firstDefined(env.OR3_BACKGROUND_JOB_TIMEOUT, '300')
);

const adminUsername = firstDefined(env.OR3_ADMIN_USERNAME);
const adminPassword = firstDefined(env.OR3_ADMIN_PASSWORD);
const adminJwtSecret = firstDefined(
    env.OR3_ADMIN_JWT_SECRET,
    env.OR3_BASIC_AUTH_JWT_SECRET && createHash('sha256').update(`or3-admin:${env.OR3_BASIC_AUTH_JWT_SECRET}`).digest('hex')
);
const adminJwtExpiry = firstDefined(env.OR3_ADMIN_JWT_EXPIRY, '24h');

setDefault('NUXT_AUTH_ENABLED', authEnabled);
setDefault('NUXT_AUTH_PROVIDER', authProvider);
setDefault('NUXT_PUBLIC_SSR_AUTH_ENABLED', authEnabled);
setDefault('NUXT_PUBLIC_AUTH_PROVIDER', authProvider);
setDefault('NUXT_PUBLIC_GUEST_ACCESS_ENABLED', guestAccessEnabled);
setDefault('NUXT_AUTH_REGISTRATION_MODE', registrationMode);
setDefault('NUXT_AUTH_AUTO_PROVISION', autoProvision);
setDefault('NUXT_AUTH_BOOTSTRAP_EMAIL', bootstrapEmail);
setDefault('NUXT_AUTH_INVITE_TOKEN_SECRET', inviteTokenSecret);
setDefault('NUXT_AUTH_INVITE_TOKEN_TTL_SECONDS', inviteTokenTtlSeconds);

setDefault('NUXT_SYNC_ENABLED', syncEnabled);
setDefault('NUXT_SYNC_PROVIDER', syncProvider);
setDefault('NUXT_PUBLIC_SYNC_ENABLED', syncEnabled);
setDefault('NUXT_PUBLIC_SYNC_PROVIDER', syncProvider);

setDefault('NUXT_STORAGE_ENABLED', storageEnabled);
setDefault('NUXT_STORAGE_PROVIDER', storageProvider);
setDefault('NUXT_PUBLIC_STORAGE_ENABLED', storageEnabled);
setDefault('NUXT_PUBLIC_STORAGE_PROVIDER', storageProvider);

setDefault('NUXT_BACKGROUND_JOBS_ENABLED', backgroundEnabled);
setDefault('NUXT_PUBLIC_BACKGROUND_STREAMING_ENABLED', backgroundEnabled);
setDefault('NUXT_BACKGROUND_JOBS_STORAGE_PROVIDER', backgroundProvider);
setDefault('NUXT_BACKGROUND_JOBS_MAX_CONCURRENT_JOBS', backgroundMaxJobs);
setDefault(
    'NUXT_BACKGROUND_JOBS_MAX_CONCURRENT_JOBS_PER_USER',
    backgroundMaxJobsPerUser
);
setDefault(
    'NUXT_BACKGROUND_JOBS_JOB_TIMEOUT_MS',
    String(
        Number.isFinite(backgroundTimeoutSeconds)
            ? backgroundTimeoutSeconds * 1000
            : 300_000
    )
);

setDefault('NUXT_ADMIN_AUTH_USERNAME', adminUsername);
setDefault('NUXT_ADMIN_AUTH_PASSWORD', adminPassword);
setDefault('NUXT_ADMIN_AUTH_JWT_SECRET', adminJwtSecret);
setDefault('NUXT_ADMIN_AUTH_JWT_EXPIRY', adminJwtExpiry);
setDefault(
    'NUXT_BACKGROUND_JOBS_ENCRYPTION_KEY',
    firstDefined(env.OR3_BACKGROUND_ENCRYPTION_KEY)
);

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('A server command is required.');

const child = spawn(command, args, { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
});
child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
});
