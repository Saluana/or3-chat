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
            'data-width': HTMLAttributes.width,
        })];
    },

    addNodeView() {
        return VueNodeViewRenderer(DocumentImageNode);
    },
});
