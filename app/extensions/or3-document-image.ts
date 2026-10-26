import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import DocumentImageNode from '~/components/documents/DocumentImageNode.vue';

export const Or3DocumentImage = Node.create({
    name: 'or3Image',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            hash: { default: '' },
            alt: { default: '' },
            title: { default: null },
            align: {
                default: 'center',
                parseHTML: (element) => {
                    const align = element.getAttribute('data-align');
                    return align === 'left' || align === 'right' ? align : 'center';
                },
                validate: (value: unknown) => {
                    if (value !== 'left' && value !== 'center' && value !== 'right') throw new Error('Invalid image alignment.');
                },
            },
            width: {
                default: 100,
                parseHTML: (element) => Number(element.getAttribute('data-width')) || 100,
            },
        };
    },

    parseHTML() {
        return [{ tag: 'figure[data-or3-image]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['figure', mergeAttributes(HTMLAttributes, {
            'data-or3-image': '',
            'data-width': HTMLAttributes.width as unknown,
            'data-align': HTMLAttributes.align as unknown,
        })];
    },

    addNodeView() {
        return VueNodeViewRenderer(DocumentImageNode);
    },
});
