import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const componentFiles = [
    '../DocumentAiPanel.vue',
    '../DocumentEditorRoot.vue',
    '../DocumentHistoryPanel.vue',
    '../DocumentImageNode.vue',
    '../DocumentInspector.vue',
];

function readComponent(relativePath: string) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('premium document editor Nuxt UI contract', () => {
    it.each(componentFiles)('uses Nuxt UI instead of visible native controls in %s', (relativePath) => {
        const source = readComponent(relativePath);
        expect(source).not.toMatch(/<(?:button|select|textarea)\b/u);

        const nativeInputs = [...source.matchAll(/<input\b[^>]*>/gu)].map((match) => match[0]);
        expect(nativeInputs.every((input) => input.includes('type="file"') && input.includes('sr-only'))).toBe(true);
    });

    it('uses the Nuxt UI interaction primitives needed by the editor experience', () => {
        const source = componentFiles.map(readComponent).join('\n');

        for (const component of [
            'UButton',
            'UInput',
            'UTextarea',
            'USelect',
            'USelectMenu',
            'UTabs',
            'UDropdownMenu',
            'UModal',
            'UFormField',
            'UCard',
            'UBadge',
            'USlider',
        ]) {
            expect(source).toContain(`<${component}`);
        }
    });

    it('keeps the compact text-style trigger from truncating its menu options', () => {
        const source = readComponent('../DocumentEditorRoot.vue');
        expect(source).toContain("content: 'w-max! min-w-44!'");
        expect(source).toContain("itemLabel: 'whitespace-nowrap overflow-visible! text-clip!'");
    });

    it('uses roomy cards for document insights and revision history', () => {
        const inspector = readComponent('../DocumentInspector.vue');
        const history = readComponent('../DocumentHistoryPanel.vue');
        expect(inspector).toContain('class="info-overview"');
        expect(inspector).toContain('class="info-grid"');
        expect(history).toContain('height: auto; min-height: 4.5rem');
        expect(history).toContain('class="revision-meta"');
    });

    it('renders the document outline as an accessible hierarchy', () => {
        const source = readComponent('../DocumentInspector.vue');
        expect(source).toContain('role="tree"');
        expect(source).toContain('role="treeitem"');
        expect(source).toContain(':aria-level="item.level"');
        expect(source).toContain('class="outline-copy"');
    });
});
