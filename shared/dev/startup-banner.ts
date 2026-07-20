/**
 * Dev-server startup banner: mode, URL, and the single most useful next step.
 * Kept out of nuxt.config.ts so that file stays under the 1k-line bar.
 */
import {
    DOCTOR_COMMAND,
    WIZARD_INIT_COMMAND,
    resolveAppUrl,
} from '../cloud/wizard/next-steps';

export type StartupBannerInput = {
    appUrl?: string;
    ssrAuthEnabled: boolean;
    /** True when SSR was requested but a provider package was missing. */
    degradedCloud?: boolean;
    authProvider?: string;
    syncEnabled?: boolean;
    syncProvider?: string;
    storageEnabled?: boolean;
    storageProvider?: string;
};

export function formatStartupBanner(input: StartupBannerInput): string {
    const appUrl = resolveAppUrl(input.appUrl);
    const lines: string[] = ['', '  ┌─ OR3 Chat'];

    if (input.ssrAuthEnabled) {
        const stack: string[] = [`auth: ${input.authProvider ?? 'unknown'}`];
        if (input.syncEnabled && input.syncProvider) {
            stack.push(`sync: ${input.syncProvider}`);
        }
        if (input.storageEnabled && input.storageProvider) {
            stack.push(`storage: ${input.storageProvider}`);
        }
        lines.push(`  │  Mode:   CLOUD (SSR) — ${stack.join(' · ')}`);
        lines.push(`  │  URL:    ${appUrl}`);
        lines.push(`  │  Admin:  ${appUrl}/admin`);
        lines.push('  │');
        lines.push(`  │  Change settings:  ${WIZARD_INIT_COMMAND}`);
        lines.push(`  │  Health check:     ${DOCTOR_COMMAND}`);
    } else {
        lines.push(
            '  │  Mode:   LOCAL (static) — your data stays in this browser'
        );
        lines.push(`  │  URL:    ${appUrl}`);
        if (input.degradedCloud) {
            lines.push('  │');
            lines.push(
                '  │  ⚠ SSR_AUTH_ENABLED=true but a provider package is missing,'
            );
            lines.push('  │    so the app fell back to LOCAL mode.');
            lines.push(`  │    Run \`${DOCTOR_COMMAND}\` to diagnose.`);
        } else {
            lines.push('  │');
            lines.push(
                '  │  First time? Open the URL — the app guides you through'
            );
            lines.push('  │  connecting your OpenRouter key.');
            lines.push('  │');
            lines.push('  │  Want accounts, sync & storage?');
            lines.push(`  │  Run: ${WIZARD_INIT_COMMAND}`);
        }
    }

    lines.push('  └──────────────────────────────────────────');
    lines.push('');
    return lines.join('\n');
}

let startupBannerPrinted = false;

export function printStartupBanner(input: StartupBannerInput): void {
    if (startupBannerPrinted) return;
    startupBannerPrinted = true;
    // eslint-disable-next-line no-console
    console.log(formatStartupBanner(input));
}
