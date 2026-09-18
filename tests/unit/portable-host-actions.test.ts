import { describe, expect, it } from 'vitest'
import {
    HOST_ACTIONS,
    MAX_HOST_ACTION_CONTENT_CHARS,
    chatTitleFrom,
    isHostAction,
    isKnownHostAction,
    planHostAction,
    tipTapToText,
} from '../../app/utils/plugins/portable-host-actions'

/**
 * Phase 9 (R7, R11, R20.AC3): writes a portable plugin asks for are planned by
 * the host from validated plugin output and the host's own selection context.
 */
describe('portable host actions', () => {
    it('classifies reserved host action ids', () => {
        expect(isHostAction('host.document.create')).toBe(true)
        expect(isHostAction('documents.create')).toBe(false)
        expect(isKnownHostAction('host.document.replace')).toBe(true)
        expect(isKnownHostAction('host.something.else')).toBe(false)
    })

    it('plans a new document from a validated result', () => {
        const result = planHostAction({
            action: HOST_ACTIONS.createDocument,
            payload: { title: '  Summary  ', content: '# Heading\n\nBody' },
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.plan).toEqual({
            kind: 'create-document',
            title: 'Summary',
            content: '# Heading\n\nBody',
            requiresConfirmation: false,
        })
    })

    it('requires the selection the host opened with for a replace, never a plugin-named target', () => {
        const refused = planHostAction({
            action: HOST_ACTIONS.replaceDocument,
            payload: { content: 'new text' },
            selectedDocumentId: null,
        })
        expect(refused).toMatchObject({ ok: false, code: 'selection-required' })

        const planned = planHostAction({
            action: HOST_ACTIONS.replaceDocument,
            payload: { content: 'new text' },
            selectedDocumentId: 'doc_1',
        })
        expect(planned.ok).toBe(true)
        if (!planned.ok) return
        expect(planned.plan).toMatchObject({
            kind: 'replace-document',
            documentId: 'doc_1',
            requiresConfirmation: true,
        })
        // A plugin-supplied target is ignored entirely.
        const ignoredTarget = planHostAction({
            action: HOST_ACTIONS.replaceDocument,
            payload: { content: 'new text', documentId: 'doc_attack' },
            selectedDocumentId: 'doc_1',
        })
        expect(ignoredTarget.ok && ignoredTarget.plan).toMatchObject({ documentId: 'doc_1' })
    })

    it('refuses empty, oversized or non-object payloads with actionable codes', () => {
        expect(planHostAction({ action: HOST_ACTIONS.createDocument, payload: null })).toMatchObject({
            ok: false,
            code: 'payload-required',
        })
        expect(
            planHostAction({ action: HOST_ACTIONS.createDocument, payload: { content: '   ' } }),
        ).toMatchObject({ ok: false, code: 'content-required' })
        expect(
            planHostAction({
                action: HOST_ACTIONS.createDocument,
                payload: { content: 'x'.repeat(MAX_HOST_ACTION_CONTENT_CHARS + 1) },
            }),
        ).toMatchObject({ ok: false, code: 'content-required' })
        expect(planHostAction({ action: 'host.unknown', payload: { content: 'x' } })).toMatchObject({
            ok: false,
            code: 'unknown-host-action',
        })
    })

    it('plans a chat continuation with a bounded title', () => {
        const result = planHostAction({
            action: HOST_ACTIONS.continueInChat,
            payload: { content: '## Chosen answer\n\nDetails here' },
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.plan).toMatchObject({
            kind: 'continue-in-chat',
            title: 'Chosen answer',
            content: '## Chosen answer\n\nDetails here',
        })
    })

    it('converts a stored document into readable text for a first action', () => {
        const text = tipTapToText({
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'First ' }, { type: 'text', text: 'sentence.' }],
                },
                {
                    type: 'bulletList',
                    content: [
                        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] },
                        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }] },
                    ],
                },
                { type: 'paragraph', content: [] },
            ],
        })
        expect(text).toBe('## Title\nFirst sentence.\n- One\n- Two')
        expect(tipTapToText(null)).toBe('')
        expect(tipTapToText({ type: 'doc', content: [] })).toBe('')
    })

    it('derives a compact single-line chat title', () => {
        expect(chatTitleFrom('\n\n# Title\nbody')).toBe('Title')
        expect(chatTitleFrom('   ')).toBe('Continued result')
        expect(chatTitleFrom('x'.repeat(80)).endsWith('…')).toBe(true)
    })
})
