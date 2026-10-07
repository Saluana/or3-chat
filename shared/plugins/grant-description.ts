/** Review copy for trusted capabilities with authority beyond isolated clients. */
export const TRUSTED_PLUGIN_GRANT_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
    'ui.workspace-profile.register': 'Register a workspace layout and navigation profile.',
    'ai.provider': 'Read the configured AI provider and its API key. The plugin receives the raw key.',
    'tools.use': 'List and execute enabled tools with their existing approval policy.',
    'jobs.background': 'Start, track and stop background work in this workspace.',
    'hooks.emit': 'Emit the approved workflow lifecycle events to the host.',
});

export function describePluginGrant(grant: string): string {
    const description = TRUSTED_PLUGIN_GRANT_DESCRIPTIONS[grant];
    return description ? `${grant}: ${description}` : grant;
}
