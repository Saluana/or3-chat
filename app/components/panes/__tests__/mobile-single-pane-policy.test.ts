import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageShell = readFileSync(
    resolve(process.cwd(), 'app/components/PageShell.vue'),
    'utf8'
);

describe('PageShell mobile pane policy', () => {
    it('disables pane creation and only renders the active pane on mobile', () => {
        expect(pageShell).toContain(
            '() => !isMobile.value && profilePaneLimit.value > 1'
        );
        expect(pageShell).toContain(
            'v-show="!isMobile || i === activePaneIndex"'
        );
        expect(pageShell).toContain(
            `:style="{ width: isMobile ? '100%' : getPaneWidth(i) }"`
        );
        expect(pageShell).toContain(
            'v-if="panes.length > 1 && !isMobile"'
        );
        expect(pageShell).toContain(
            'v-if="!isMobile && i < panes.length - 1"'
        );
    });
});
