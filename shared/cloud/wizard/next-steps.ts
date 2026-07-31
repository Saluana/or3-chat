/**
 * Canonical "what to run next" copy for CLI cheat sheets, review UI, and
 * the dev startup banner. Keep these strings in one place so docs and UX
 * don't drift.
 */
export type NextStepsContext = {
    ssrAuthEnabled?: boolean;
    connectEnabled?: boolean;
    appUrl?: string;
    packageManager?: 'npm' | 'bun';
};

const DEFAULT_APP_URL = 'http://localhost:3000';

export function resolveAppUrl(appUrl?: string): string {
    return (appUrl ?? DEFAULT_APP_URL).replace(/\/+$/, '');
}

/** Primary command to start the app after setup. */
export const START_APP_COMMAND = 'npm run dev';

/** Cloud-forced SSR start (sets SSR_AUTH_ENABLED=true). */
export const START_SSR_COMMAND = 'npm run dev:ssr';

/** Health check that includes provider/path/port checks. */
export const DOCTOR_COMMAND = 'npm run doctor';

/** Re-run / update cloud setup. */
export const WIZARD_INIT_COMMAND = 'npm run setup';

export function buildCheatSheetLines(context: NextStepsContext = {}): string[] {
    const appUrl = resolveAppUrl(context.appUrl);
    const packageManager = context.packageManager ?? 'npm';
    const lines = [
        `Start the app:    ${packageManager} run dev`,
        `Open:             ${appUrl}`,
    ];
    if (context.ssrAuthEnabled) {
        lines.push(`Admin dashboard:  ${appUrl}/admin`);
    }
    if (context.connectEnabled) {
        lines.push('Connect a computer: npx @or3/connect');
    }
    lines.push('Settings live in: .env');
    lines.push(`Re-run wizard:     ${packageManager} run setup`);
    lines.push(`Health check:      ${packageManager} run doctor`);
    return lines;
}

export function buildApplyOnlySuccessBody(
    connectEnabled = false,
    packageManager: 'npm' | 'bun' = 'npm'
): string {
    const connectMessage = connectEnabled
        ? ' After OR3 is running publicly, connect a computer with npx @or3/connect.'
        : '';
    return `Your .env and provider modules were written. Start the app with ${packageManager} run dev when you are ready.${connectMessage}`;
}
