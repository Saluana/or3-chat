import type { UserFontChoice } from './user-overrides-types';

export const USER_FONT_OPTIONS: ReadonlyArray<{
    value: UserFontChoice;
    label: string;
}> = [
    { value: 'theme', label: 'Theme default' },
    { value: 'system', label: 'System interface' },
    { value: 'ibm-plex-sans', label: 'IBM Plex Sans' },
    { value: 'vt323', label: 'VT323' },
    { value: 'press-start-2p', label: 'Press Start 2P' },
];

const FONT_STACKS: Record<Exclude<UserFontChoice, 'theme'>, string> = {
    system: 'ui-sans-serif, system-ui, sans-serif',
    'ibm-plex-sans': '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
    vt323: '"VT323", "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
    'press-start-2p':
        '"Press Start 2P", "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
};

export function isUserFontChoice(value: unknown): value is UserFontChoice {
    return USER_FONT_OPTIONS.some((option) => option.value === value);
}

export function resolveUserFontStack(
    choice: unknown,
    role: 'body' | 'heading'
): string {
    if (!isUserFontChoice(choice) || choice === 'theme') {
        return role === 'body' ? 'var(--font-sans)' : 'var(--font-heading)';
    }
    return FONT_STACKS[choice];
}
