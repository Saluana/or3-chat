import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import blankAppConfig from '../app.config';

const blankStyles = readFileSync(
    resolve(process.cwd(), 'app/theme/blank/styles.css'),
    'utf8',
);
const chatInput = readFileSync(
    resolve(process.cwd(), 'app/theme/blank/components/ChatInput.vue'),
    'utf8',
);
const chatOverrides = readFileSync(
    resolve(process.cwd(), 'app/theme/blank/styles/chat.ts'),
    'utf8',
);
const sidebarOverrides = readFileSync(
    resolve(process.cwd(), 'app/theme/blank/styles/sidebar.ts'),
    'utf8',
);

describe('blank theme mobile control sizing', () => {
    it('defines an Apple-sized mobile interaction and type scale', () => {
        expect(blankStyles).toContain('--blank-mobile-control-min: 44px');
        expect(blankStyles).toContain('--blank-mobile-control-text: 16px');
        expect(blankStyles).toContain('--blank-mobile-supporting-text: 12px');
        expect(blankStyles).toContain('[role="button"]');
        expect(blankStyles).toContain('[role="menuitem"]');
        expect(blankStyles).toContain('[role="option"]');
        expect(blankStyles).toContain('[role="tab"]');
        expect(blankStyles).toContain('min-height: var(--blank-mobile-control-min) !important');
        expect(blankStyles).toContain('min-width: var(--blank-mobile-control-min) !important');
    });

    it('keeps Nuxt UI mobile variants at least 44px without changing desktop sizes', () => {
        const buttonSizes = blankAppConfig.ui.button.variants.size;
        expect(buttonSizes.xs.base).toContain('h-[24px]');
        expect(buttonSizes.sm.base).toContain('h-[32px]');
        expect(buttonSizes.md.base).toContain('h-[36px]');
        expect(buttonSizes.xs.base).toContain('max-md:min-h-[44px]!');
        expect(buttonSizes.sm.base).toContain('max-md:min-h-[44px]!');
        expect(buttonSizes.md.base).toContain('max-md:min-h-[44px]!');
        expect(blankAppConfig.ui.modal.slots.close).toContain('max-md:min-h-[44px]!');
        expect(blankAppConfig.ui.toast.slots.close).toContain('max-md:min-h-[44px]!');
        expect(blankAppConfig.ui.tabs.slots.trigger).toContain('max-md:min-h-[44px]!');
    });

    it('uses 44px controls in the fixed-position mobile composers', () => {
        expect(chatInput).toContain('width: 2.75rem');
        expect(chatInput).toContain('height: 2.75rem');
        expect(chatInput).toContain('flex-basis: 2.75rem');
        expect(blankStyles).toContain('.document-ai-composer');
        expect(blankStyles).toContain('.attachment-button');
        expect(blankStyles).toContain('.settings-button');
        expect(blankStyles).toContain('.send-button');
    });

    it('keeps chat and sidebar override-specific controls touch sized', () => {
        expect(chatOverrides).toContain('max-md:min-h-[44px]!');
        expect(chatOverrides).toContain('max-md:min-w-[44px]!');
        expect(chatOverrides).toContain('max-md:text-[16px]!');
        expect(sidebarOverrides).toContain('max-md:min-h-[44px]!');
        expect(sidebarOverrides).toContain('max-md:min-w-[44px]!');
        expect(sidebarOverrides).toContain('max-md:text-[16px]!');
    });
});
