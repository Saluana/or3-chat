import { describe, expect, it } from 'vitest';
import type { ToolDefinition } from '~/utils/chat/types';
import {
    isDocumentAiNativeTool,
    isDocumentAiToolEnabled,
    resolveDocumentAiAgentTools,
} from '../document-ai-tools';
import { sanitizeDocumentAiSettings } from '~/composables/documents/useDocumentAiSettings';

const chatTool = (name: string, runtime: ToolDefinition['runtime'] = 'hybrid'): ToolDefinition => ({
    type: 'function',
    function: {
        name,
        description: `${name} tool`,
        parameters: { type: 'object', properties: {} },
    },
    runtime,
    ui: { label: name, category: 'Chat' },
});

describe('document AI tool selection', () => {
    it('defaults native tools on and registry tools off', () => {
        expect(isDocumentAiNativeTool('propose_edits')).toBe(true);
        expect(isDocumentAiToolEnabled('propose_edits', {})).toBe(true);
        expect(isDocumentAiToolEnabled('web_search', {})).toBe(false);
    });

    it('honors explicit enabledTools overrides', () => {
        expect(isDocumentAiToolEnabled('propose_edits', { propose_edits: false })).toBe(false);
        expect(isDocumentAiToolEnabled('web_search', { web_search: true })).toBe(true);
    });

    it('resolves native + opted-in chat tools and skips server-only', () => {
        const tools = resolveDocumentAiAgentTools({
            enabledTools: {
                search_document: false,
                web_search: true,
                admin_only: true,
            },
            registryDefinitions: [
                chatTool('web_search'),
                chatTool('admin_only', 'server'),
            ],
        });
        const names = tools.map((tool) => tool.function.name);
        expect(names).toContain('propose_edits');
        expect(names).toContain('web_search');
        expect(names).not.toContain('search_document');
        expect(names).not.toContain('admin_only');
    });

    it('persists enabledTools through settings sanitize', () => {
        const settings = sanitizeDocumentAiSettings({
            enabledTools: {
                web_search: true,
                propose_edits: true,
                bad: 'yes',
                '': false,
            },
        });
        expect(settings.enabledTools).toEqual({
            web_search: true,
            propose_edits: true,
        });
    });
});
