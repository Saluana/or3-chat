import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/vue-3';
import DocumentInspector from '../DocumentInspector.vue';
import DocumentTableToolbar from '../DocumentTableToolbar.vue';

const ButtonStub = defineComponent({
    inheritAttrs: false,
    props: {
        label: { type: String, default: '' },
    },
    emits: ['click'],
    setup(props, { attrs, emit, slots }) {
        return () =>
            h(
                'button',
                {
                    ...attrs,
                    onClick: (event: MouseEvent) => emit('click', event),
                },
                [props.label, slots.default?.()]
            );
    },
});

const global = {
    directives: {
        theme: () => {},
    },
    stubs: {
        UButton: ButtonStub,
        UBadge: { template: '<span><slot /></span>' },
        UIcon: true,
        UTabs: true,
    },
};

describe('document editor behavior', () => {
    it('reports inspector tab changes for workspace view-state capture', async () => {
        const wrapper = mount(DocumentInspector, {
            props: {
                editor: null,
                documentId: 'document-1',
                createCheckpoint: vi.fn(),
                outline: [],
                activeOutlineId: undefined,
                stats: {
                    words: 0,
                    characters: 0,
                    blocks: 0,
                    readingMinutes: 0,
                    serializedBytes: 0,
                },
                pluginPanels: [],
                initialTab: 'outline',
            },
            global,
        });

        await wrapper.setProps({ initialTab: 'history' });

        expect(wrapper.emitted('update:active-tab')).toContainEqual([
            'history',
        ]);
    });

    it('renders its outline as an accessible hierarchy and selects headings', async () => {
        const outline = [
            { id: 'intro', level: 1 as const, text: 'Intro', position: 0 },
            { id: 'details', level: 2 as const, text: 'Details', position: 10 },
        ];
        const wrapper = mount(DocumentInspector, {
            props: {
                editor: null,
                documentId: 'document-1',
                createCheckpoint: vi.fn(),
                outline,
                activeOutlineId: 'details',
                stats: {
                    words: 2,
                    characters: 12,
                    blocks: 2,
                    readingMinutes: 1,
                    serializedBytes: 12,
                },
                pluginPanels: [],
            },
            global,
        });

        expect(wrapper.get('[role="tree"]').attributes('aria-label')).toBe(
            'Document heading hierarchy'
        );
        const items = wrapper.findAll('[role="treeitem"]');
        expect(items.map((item) => item.attributes('aria-level'))).toEqual([
            '1',
            '2',
        ]);
        expect(items[1]!.attributes('aria-current')).toBe('location');

        await items[0]!.trigger('click');
        expect(wrapper.emitted('outline-select')).toEqual([[outline[0]]]);
    });

    it('renders table controls and executes every contextual table command', async () => {
        const chain = {
            focus: vi.fn(),
            addRowBefore: vi.fn(),
            addRowAfter: vi.fn(),
            deleteRow: vi.fn(),
            addColumnBefore: vi.fn(),
            addColumnAfter: vi.fn(),
            deleteColumn: vi.fn(),
            deleteTable: vi.fn(),
            run: vi.fn(() => true),
        };
        chain.focus.mockReturnValue(chain);
        chain.addRowBefore.mockReturnValue(chain);
        chain.addRowAfter.mockReturnValue(chain);
        chain.deleteRow.mockReturnValue(chain);
        chain.addColumnBefore.mockReturnValue(chain);
        chain.addColumnAfter.mockReturnValue(chain);
        chain.deleteColumn.mockReturnValue(chain);
        chain.deleteTable.mockReturnValue(chain);
        const editor = {
            chain: () => chain,
        } as unknown as Editor;
        const wrapper = mount(DocumentTableToolbar, {
            props: { editor, tableIcon: 'table' },
            global,
        });

        expect(wrapper.get('[role="toolbar"]').attributes('aria-label')).toBe(
            'Table controls'
        );
        const commands = [
            ['Row above', 'addRowBefore'],
            ['Row below', 'addRowAfter'],
            ['Delete row', 'deleteRow'],
            ['Column left', 'addColumnBefore'],
            ['Column right', 'addColumnAfter'],
            ['Delete column', 'deleteColumn'],
            ['Delete table', 'deleteTable'],
        ] as const;
        for (const [label, command] of commands) {
            const button = wrapper
                .findAll('button')
                .find((candidate) => candidate.text() === label);
            expect(button, `missing ${label} control`).toBeDefined();
            await button!.trigger('click');
            expect(chain[command]).toHaveBeenCalledTimes(1);
        }
        expect(chain.run).toHaveBeenCalledTimes(commands.length);
        expect(wrapper.emitted('deleted')).toHaveLength(1);
    });
});
