/**
 * Keyboard shortcut labels that match the user's platform: "⌘B" / "⇧⌘Z" on
 * Apple devices, "Ctrl+B" / "Ctrl+Shift+Z" elsewhere.
 *
 * Detection reads `navigator`, so components that server-render should resolve
 * it after mount (default to Apple until then) to keep hydration stable.
 */
export function isApplePlatform(): boolean {
    if (typeof navigator === 'undefined') return true;
    return /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform || ''} ${navigator.userAgent || ''}`);
}

export function formatShortcut(
    key: string,
    options: { shift?: boolean; apple?: boolean } = {},
): string {
    const apple = options.apple ?? isApplePlatform();
    const upper = key.toUpperCase();
    if (apple) return `${options.shift ? '⇧' : ''}⌘${upper}`;
    return `Ctrl+${options.shift ? 'Shift+' : ''}${upper}`;
}
