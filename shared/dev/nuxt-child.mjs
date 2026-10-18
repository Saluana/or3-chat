import { runCommand } from '@nuxt/cli';

// The public CLI command returns an async close handle. Its ordinary signal
// path can exit before Nitro worker cleanup, so this owned child awaits that
// handle. The outer OR3 supervisor owns replacement and the process group.
// Disable Nuxt's warming forks: one lifecycle owner must close the live app.
const inheritedSignals = new Map(['SIGTERM', 'SIGINT'].map(signal => [signal, new Set(process.listeners(signal))]));
function claimSignalOwnership() {
    // Listhen's auto-close registers immediate process.exit signal handlers.
    // They would race this awaited close even with Nuxt's forks disabled.
    // Retain inherited handlers; this owned CLI delegates newly registered
    // runtime cleanup to Nuxt's close hooks instead of a second exit path.
    for (const [signal, inherited] of inheritedSignals) {
        for (const listener of process.listeners(signal)) {
            if (listener !== close && !inherited.has(listener)) process.removeListener(signal, listener);
        }
    }
}
const startup = runCommand('dev', [...process.argv.slice(2), '--no-fork'], {
    overrides: { hooks: { listen: claimSignalOwnership } },
});
let closing;
function close() {
    if (closing) return closing;
    closing = (async () => {
        const timeout = setTimeout(() => {
            console.error('[shutdown] Development cleanup exceeded 20 seconds');
            process.exit(1);
        }, 20_000);
        timeout.unref();
        let code = 0;
        try {
            const { result } = await startup;
            if (!result || typeof result.close !== 'function') throw new Error('Nuxt did not provide its lifecycle close handle');
            await result.close();
        } catch (error) {
            console.error('[shutdown] Development cleanup failed:', error instanceof Error ? error.message : 'close_failed');
            code = 1;
        } finally { clearTimeout(timeout); }
        // This is the sole final-exit owner of the development CLI process.
        // Managed application exit remains owned by Nitro.
        process.exit(code);
    })();
    return closing;
}
process.once('SIGTERM', close);
process.once('SIGINT', close);
try { await startup; claimSignalOwnership(); }
catch (error) {
    console.error(error instanceof Error ? error.message : 'Development startup failed');
    await close();
}
