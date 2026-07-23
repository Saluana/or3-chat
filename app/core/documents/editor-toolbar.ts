export const DOCUMENT_BLOCK_TYPE_ITEMS: Array<{
    label: string;
    value: string;
}> = [
    { label: 'Text', value: 'paragraph' },
    { label: 'Heading 1', value: 'heading-1' },
    { label: 'Heading 2', value: 'heading-2' },
    { label: 'Heading 3', value: 'heading-3' },
];

export type DocumentToolbarItem = {
    id: string;
    icon?: string;
    text?: string;
    label: string;
    active?: () => boolean;
    run: () => void;
};
