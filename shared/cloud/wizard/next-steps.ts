/**
 * Canonical "what to run next" copy for CLI cheat sheets, review UI, and
 * the dev startup banner. Keep these strings in one place so docs and UX
 * don't drift.
 */
export type NextStepsContext = {
    ssrAuthEnabled?: boolean;
    connectEnabled?: boolean;
    appUrl?: string;
};

const DEFAULT_APP_URL = 'http://localhost:3000';

export function resolveAppUrl(appUrl?: string): string {
    return (appUrl ?? DEFAULT_APP_URL).replace(/\/+$/, '');
}

/** Primary command to start the app after setup. */
export const START_APP_COMMAND = 'bun run dev';

/** Cloud-forced SSR start (sets SSR_AUTH_ENABLED=true). */
export const START_SSR_COMMAND = 'bun run dev:ssr';

/** Health check that includes provider/path/port checks. */
export const DOCTOR_COMMAND = 'bun run or3-cloud:doctor';

/** Re-run / update cloud setup. */
export const WIZARD_INIT_COMMAND = 'bun run or3-cloud:init';

export function buildCheatSheetLines(context: NextStepsContext = {}): string[] {
    const appUrl = resolveAppUrl(context.appUrl);
    const lines = [
        `Start the app:    ${START_APP_COMMAND}`,
        `Open:             ${appUrl}`,
    ];
    if (context.ssrAuthEnabled) {
        lines.push(`Admin dashboard:  ${appUrl}/admin`);
    }
    if (context.connectEnabled) {
        lines.push('Connect a computer: npx or3 connect');
    }
    lines.push('Settings live in: .env');
    lines.push(`Re-run wizard:     ${WIZARD_INIT_COMMAND}`);
    lines.push(`Health check:      ${DOCTOR_COMMAND}`);
    return lines;
}

export function buildApplyOnlySuccessBody(connectEnabled = false): string {
    const connectMessage = connectEnabled
        ? ' After OR3 is running publicly, connect a computer with npx or3 connect.'
        : '';
    return `Your .env and provider modules were written. Start the app with ${START_APP_COMMAND} (or bun start) when you are ready.${connectMessage}`;
}
