import { describe, expect, it } from 'vitest';
import { ui } from '@or3/plugin-sdk/ui';
import {
    PORTABLE_UI_MAX_ITEMS,
    renderSanitizedMarkdown,
    validatePortableUiNode,
    type PortableUiNode,
} from '../ui-primitives';

describe('portable UI primitives (4.5)', () => {
    it('accepts every declared primitive from the typed author wrapper', () => {
        const nodes: PortableUiNode[] = [
            ui.text('hello'),
            ui.markdown('**bold**'),
            ui.link('docs', 'https://example.com/docs'),
            ui.column(ui.text('a'), ui.row(ui.text('b'))),
            ui.box(ui.text('c')),
            ui.form('settings', [
                ui.textField('name', 'Name', { value: 'x', required: true }),
                ui.textarea('notes', 'Notes', { rows: 5 }),
                ui.select('mode', 'Mode', [
                    { value: 'a', label: 'A' },
                    { value: 'b', label: 'B' },
                ]),
                ui.toggle('enabled', 'Enabled', { value: true }),
                ui.button('save', 'Save', 'save'),
            ]),
            ui.table([{ key: 'k', label: 'Key' }], [{ k: 'v' }], 'caption'),
            ui.list([{ label: 'one', description: 'first' }], true),
            ui.progress(3, { max: 10, label: 'Working' }),
            ui.result('Summary', 'text'),
            ui.openDocument('Open', 'doc_1'),
            ui.openPane('Open pane', 'pane_1'),
        ];

        const validated = nodes.map((node) => validatePortableUiNode(node));
        expect(validated.every((entry) => entry.ok)).toBe(true);
    });

    it('rejects functions, components, unknown types and off-policy links', () => {
        expect(
            validatePortableUiNode({ type: 'button', id: 'b', label: 'x', action: 'a', onClick: () => {} })
        ).toMatchObject({ ok: false, code: 'ui-invalid-node' });

        expect(validatePortableUiNode({ type: 'component', name: 'ChatInput' })).toMatchObject({
            ok: false,
        });

        expect(validatePortableUiNode(ui.link('bad', 'http://example.com'))).toMatchObject({
            ok: false,
        });

        expect(validatePortableUiNode(ui.link('bad', 'javascript:alert(1)'))).toMatchObject({
            ok: false,
        });

        expect(
            validatePortableUiNode({
                type: 'box',
                children: [{ type: 'iframe', src: 'https://evil.example' }],
            })
        ).toMatchObject({ ok: false });

        expect(validatePortableUiNode({ type: 'field.text', id: 'not a valid id!', label: 'x' })).toMatchObject(
            { ok: false }
        );
    });

    it('bounds values so a tree cannot flood the renderer', () => {
        expect(
            validatePortableUiNode({
                type: 'list',
                items: Array.from({ length: PORTABLE_UI_MAX_ITEMS + 1 }, () => ({ label: 'x' })),
            })
        ).toMatchObject({ ok: false, message: expect.stringContaining('exceed') });

        expect(validatePortableUiNode(ui.text('x'.repeat(9 * 1024)))).toMatchObject({
            ok: false,
        });

        expect(validatePortableUiNode({ type: 'progress', value: Number.NaN })).toMatchObject({
            ok: false,
        });
    });

    it('strips unknown keys and clamps progress into range', () => {
        const text = validatePortableUiNode({
            type: 'text',
            text: 'hi',
            style: 'background: url(https://evil)',
            class: 'publisher-class',
        });
        expect(text).toEqual({ ok: true, node: { type: 'text', text: 'hi' } });

        const progress = validatePortableUiNode({ type: 'progress', value: 500, max: 100 });
        expect(progress).toMatchObject({ ok: true, node: { value: 100, max: 100 } });
    });

    it('sanitizes markdown so publisher text cannot inject markup', () => {
        const cases: Array<[string, string]> = [
            ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
            ['<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert(1)&gt;'],
            ['[click](javascript:alert(1))', '[click](javascript:alert(1))'],
            ['<a href="https://evil">x</a>', '&lt;a href=&quot;https://evil&quot;&gt;x&lt;/a&gt;'],
        ];
        for (const [input, expectedFragment] of cases) {
            const html = renderSanitizedMarkdown(input);
            expect(html).not.toContain('<script');
            expect(html).not.toContain('<img');
            expect(html).not.toContain('href="javascript:');
            expect(html).toContain(expectedFragment);
        }
    });

    it('renders the supported markdown subset', () => {
        expect(renderSanitizedMarkdown('**bold**')).toContain('<strong>bold</strong>');
        expect(renderSanitizedMarkdown('*italic*')).toContain('<em>italic</em>');
        expect(renderSanitizedMarkdown('`code`')).toContain('<code>code</code>');
        expect(renderSanitizedMarkdown('- a\n- b')).toContain('<ul>');
        expect(renderSanitizedMarkdown('1. a\n2. b')).toContain('<ol>');
        expect(
            renderSanitizedMarkdown('[docs](https://example.com)')
        ).toContain('href="https://example.com"');
        expect(renderSanitizedMarkdown('first\n\nsecond')).toContain('<p>first</p>');
    });
});
