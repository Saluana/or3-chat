import {
    APP_THEME_COMPONENT_KEYS,
    THEME_COMPONENT_CONTRACT_VERSION,
    type AppThemeComponent,
} from './types';

export interface ThemeComponentContract {
    version: typeof THEME_COMPONENT_CONTRACT_VERSION;
    requiredProps: readonly string[];
    requiredEmits: readonly string[];
    requiredSlots: readonly string[];
    accessibility: readonly string[];
}

const DEFAULT_CONTRACT: ThemeComponentContract = Object.freeze({
    version: THEME_COMPONENT_CONTRACT_VERSION,
    requiredProps: [],
    requiredEmits: [],
    requiredSlots: [],
    accessibility: ['Preserve the core component semantic role and keyboard behavior.'],
});

const contracts = {} as Record<AppThemeComponent, ThemeComponentContract>;
for (const key of APP_THEME_COMPONENT_KEYS) contracts[key] = DEFAULT_CONTRACT;
Object.assign(contracts, {
    sidebar: {
        ...DEFAULT_CONTRACT,
        requiredEmits: [
            'chat-selected', 'new-chat', 'new-document', 'document-selected',
            'toggle-dashboard',
        ],
    },
    'chat-input': {
        ...DEFAULT_CONTRACT,
        requiredProps: ['loading', 'streaming', 'containerWidth', 'threadId', 'paneId'],
        requiredEmits: [
            'send', 'model-change', 'stop-stream', 'pending-prompt-selected', 'resize',
        ],
    },
    'workflow-status': {
        ...DEFAULT_CONTRACT,
        accessibility: [
            'Expose status changes to assistive technology and preserve action labels.',
        ],
    },
} satisfies Partial<Record<AppThemeComponent, ThemeComponentContract>>);

export const THEME_COMPONENT_CONTRACTS: Readonly<
    Record<AppThemeComponent, ThemeComponentContract>
> = Object.freeze(contracts);

export function getThemeComponentContract(
    target: AppThemeComponent
): ThemeComponentContract {
    return THEME_COMPONENT_CONTRACTS[target];
}
