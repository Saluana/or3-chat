import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const componentFiles = ['../DocumentAiPanel.vue', '../DocumentEditorRoot.vue', '../DocumentHistoryPanel.vue', '../DocumentImageNode.vue', '../DocumentInspector.vue'];

function readComponent(relativePath: string) {
    const componentUrl = new URL(relativePath, import.meta.url);
    const source = readFileSync(fileURLToPath(componentUrl), 'utf8');
    const styleSources = [...source.matchAll(/<style\b[^>]*\bsrc="([^"]+)"[^>]*>/gu)]
        .map((match) => match[1])
        .filter((path): path is string => Boolean(path))
        .map((path) =>
            readFileSync(fileURLToPath(new URL(path, componentUrl)), 'utf8')
        );
    return [source, ...styleSources].join('\n');
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
        expect(history).toContain('min-height: 4.5rem');
        expect(history).toContain('class="revision-meta"');
    });

    it('opens revision preview in a modal instead of pinning it above the list', () => {
        const history = readComponent('../DocumentHistoryPanel.vue');
        expect(history).toContain('<UModal');
        expect(history).toContain('label="Restore this version"');
        expect(history).toContain('openPreview(revision)');
        expect(history).not.toContain('class="revision-preview"');
        expect(history).toContain('var(--md-border-width)');
        expect(history).toContain('var(--md-border-radius)');
        expect(history).not.toContain('rounded-xl!');
    });

    it('uses theme border tokens on document AI surfaces', () => {
        const source = readComponent('../DocumentAiPanel.vue');
        expect(source).toContain('border: var(--md-border-width) solid var(--md-border-color)');
        expect(source).toContain('border-radius: var(--md-border-radius)');
        expect(source).not.toContain('border: 1px solid var(--md-outline-variant)');
        expect(source).not.toContain('border-radius: 0.8rem');
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

    it('document AI model picker uses favorites, a non-empty inherit value, and untruncated menu labels', () => {
        const source = readComponent('../DocumentAiPanel.vue');

        expect(source).toContain("INHERIT_MODEL_VALUE = 'inherit'");
        expect(source).toContain('favoriteToolModels');
        expect(source).toContain('getFavoriteModels');
        expect(source).toContain("itemLabel: 'whitespace-nowrap overflow-visible! text-clip!'");
        expect(source).not.toContain("value: ''");
        expect(source).not.toContain('catalog.value.filter((model) => model.supported_parameters?.includes(\'tools\'))');
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

    it('uses a structured TipTap composer for Document AI commands and references', () => {
        const panel = readComponent('../DocumentAiPanel.vue');
        const editor = readComponent('../DocumentAiPromptEditor.vue');
        const agent = readComponent('../../../composables/documents/useDocumentAiAgent.ts');

        expect(panel).toContain('<DocumentAiPromptEditor');
        expect(panel).toContain('@update:references="references = $event"');
        expect(editor).toContain('DocumentAiSlashCommand.configure');
        expect(editor).toContain('MentionWithAttrs.configure');
        expect(editor).toContain("'Mod-Enter'");
        expect(editor).toContain('class="context-chips"');
        expect(agent).toContain('Read-only reference context:');
        expect(agent).toContain('referenceContext(submission.references, true)');
        expect(agent).not.toContain("modalities: ['text']");
    });
});
