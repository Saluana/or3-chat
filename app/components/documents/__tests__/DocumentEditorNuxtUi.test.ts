import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const componentFiles = ['../DocumentAiPanel.vue', '../DocumentEditorRoot.vue', '../DocumentHistoryPanel.vue', '../DocumentImageNode.vue', '../DocumentInspector.vue'];

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

        for (const component of ['UButton', 'UInput', 'UTextarea', 'USelect', 'USelectMenu', 'UTabs', 'UDropdownMenu', 'UModal', 'UFormField', 'UCard', 'UBadge', 'USlider']) {
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

    it('supports configurable tables and complete contextual table controls', () => {
        const source = readComponent('../DocumentEditorRoot.vue');

        expect(source).toContain('v-model.number="tableRows"');
        expect(source).toContain('v-model.number="tableColumns"');
        expect(source).toContain('withHeaderRow: tableHeaderRow.value');
        expect(source).toContain('const tableActive = computed');
        for (const command of ['addRowBefore()', 'addRowAfter()', 'deleteRow()', 'addColumnBefore()', 'addColumnAfter()', 'deleteColumn()', 'deleteTable()']) {
            expect(source).toContain(command);
        }
    });

    it('animates the Document AI settings and inspector while respecting reduced motion', () => {
        const editor = readComponent('../DocumentEditorRoot.vue');
        const aiPanel = readComponent('../DocumentAiPanel.vue');

        expect(editor).toContain('<Transition name="document-inspector">');
        expect(editor).toContain('<Transition name="inspector-backdrop">');
        expect(editor).toContain('<Transition name="table-toolbar">');
        expect(aiPanel).toContain('<Transition name="ai-settings">');
        expect(editor).toContain('@media (prefers-reduced-motion: reduce)');
        expect(aiPanel).toContain('@media (prefers-reduced-motion: reduce)');
    });

    it('keeps the Document AI composer compact and moves advanced controls into structured settings', () => {
        const source = readComponent('../DocumentAiPanel.vue');
        const agent = readComponent('../../../composables/documents/useDocumentAiAgent.ts');

        expect(source).not.toContain('composer-spark');
        expect(source).toContain('aria-label="Add image or PDF"');
        expect(source).toContain('accept="image/*,application/pdf"');
        expect(source).toContain('class="settings-grid"');
        expect(source).toContain('class="quick-action-row"');
        expect(source).toContain('Duplicate ${action.label}');
        expect(source).toContain('<USwitch');
        expect(agent).toContain("type: 'image_url'");
        expect(agent).toContain("type: 'file'");
    });

    it('presents quick actions as scannable summaries with a structured edit form', () => {
        const source = readComponent('../DocumentAiPanel.vue');

        expect(source).toContain('class="quick-action-summary"');
        expect(source).toContain('class="quick-action-edit-header"');
        expect(source).toContain('class="quick-action-fields"');
        expect(source).toContain('label="Button label"');
        expect(source).toContain('label="Default scope"');
        expect(source).toContain('label="Prompt"');
        expect(source).toContain('Changes save automatically.');
        expect(source).toContain('label="Use"');
        expect(source).toContain('class="quick-action-empty"');
    });
});
