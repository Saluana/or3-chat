import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import blankTheme from '../theme';

const blankUi = blankTheme.ui as any;

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
        expect(blankStyles).toContain('--blank-mobile-label-text: 14px');
        expect(blankStyles).toContain('--blank-mobile-icon-size: 20px');
        expect(blankStyles).toContain('--blank-mobile-supporting-text: 12px');
        expect(blankStyles).toContain(
            'button:not([role="switch"]):not([role="checkbox"]):not([role="radio"])',
        );
        expect(blankStyles).toContain('[role="menuitem"]');
        expect(blankStyles).toContain('[role="option"]');
        expect(blankStyles).toContain('[role="tab"]');
        expect(blankStyles).toContain('min-height: var(--blank-mobile-control-min) !important');
        expect(blankStyles).toContain('min-width: var(--blank-mobile-control-min) !important');
    });

    it('keeps switch tracks compact while their surrounding rows remain touch sized', () => {
        const primaryTouchSelector = blankStyles.match(
            /html\[data-theme="blank"\] :where\(([\s\S]*?)\)\s*\{\s*min-height: var\(--blank-mobile-control-min\)/,
        );
        expect(primaryTouchSelector?.[1]).toBeDefined();
        expect(primaryTouchSelector?.[1]).not.toContain(
            '\n        [role="switch"],',
        );
        expect(blankStyles).toContain('.chat-settings-switch');
        expect(blankStyles).toContain(
            '[data-slot="root"]:has([role="switch"])',
        );
    });

    it('uses a readable but compact mobile hierarchy for sidebar content', () => {
        expect(blankStyles).toContain('.sb-group-header-action');
        expect(blankStyles).toContain('.page-link-label');
        expect(blankStyles).toContain('.page-link-description');
        expect(blankStyles).toContain('.sb-btn-title');
        expect(blankStyles).toContain('.sb-btn-icon');
        expect(blankStyles).toContain('padding-right: 2.5rem !important');
        expect(blankStyles).toContain('font-size: 8px !important');
        expect(blankStyles).toContain('min-height: 56px !important');
        expect(blankStyles).toContain('padding-block: 6px !important');
        expect(blankStyles).toContain('.basic-auth-account-menu');
        expect(blankStyles).toContain('border: 1px solid rgba(0, 0, 0, 0.1)');
        expect(blankStyles).toContain('[aria-label="Account menu"]');
        expect(blankStyles).toContain('.sidebar-rail-caption');
        expect(blankStyles).toContain('.sidebar-mode-badge');
    });

    it('keeps tokenized desktop fallbacks and 44px mobile variants', () => {
        const buttonSizes = blankUi.button.variants.size;
        expect(buttonSizes.xs.base).toContain('h-[24px]');
        expect(buttonSizes.sm.base).toContain(
            'h-[var(--app-control-height-small,32px)]',
        );
        expect(buttonSizes.md.base).toContain(
            'h-[var(--app-control-height-medium,36px)]',
        );
        expect(buttonSizes.xs.base).toContain('max-md:min-h-[44px]!');
        expect(buttonSizes.sm.base).toContain('max-md:min-h-[44px]!');
        expect(buttonSizes.md.base).toContain('max-md:min-h-[44px]!');
        expect(blankUi.modal.slots.close).toContain('max-md:min-h-[44px]!');
        expect(blankUi.toast.slots.close).toContain('max-md:min-h-[44px]!');
        expect(blankUi.tabs.slots.trigger).toContain('max-md:min-h-[44px]!');
    });

    it('uses compact visible controls with expanded hit areas in the mobile composer', () => {
        expect(chatInput).toContain('width: 2.25rem !important');
        expect(chatInput).toContain('height: 2.25rem !important');
        expect(chatInput).toContain('width: 2rem !important');
        expect(chatInput).toContain('inset: -0.375rem');
        expect(chatInput).toContain('position: static');
        expect(chatInput).toContain('float: left');
        expect(chatInput).toContain('height: 0');
        expect(chatInput).toContain('margin-inline-start: -2px');
        expect(chatInput).toContain('line-height: 1.25 !important');
        expect(chatInput).toContain('caret-color: transparent');
        expect(chatInput).toContain('height: 1rem');
        expect(chatInput).toContain('blank-mobile-caret-blink');
        expect(blankStyles).toContain('(display-mode: standalone)');
        expect(blankStyles).toContain(
            'padding-bottom: max(34px, env(safe-area-inset-bottom)) !important',
        );
        expect(blankStyles).toContain('.document-ai-composer');
        expect(blankStyles).toContain(
            'html[data-theme="blank"] .document-ai-composer :is(\n        .attachment-button,\n        .settings-button\n    )',
        );
        expect(blankStyles).toContain(
            'html[data-theme="blank"] .document-ai-composer .send-button',
        );
        expect(blankStyles).toMatch(
            /\.document-ai-composer[\s\S]*?padding: 0\.45rem 0\.5rem !important/,
        );
        expect(blankStyles).toMatch(
            /\.document-ai-composer[\s\S]*?width: 1\.75rem !important/,
        );
        expect(blankStyles).toMatch(
            /\.document-ai-composer[\s\S]*?\.send-button[\s\S]*?width: 1\.875rem !important/,
        );
        expect(blankStyles).toMatch(
            /\.document-ai-composer[\s\S]*?max-height: 1\.875rem !important/,
        );
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
