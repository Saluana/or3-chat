/**
 * Typed author wrapper for the portable host-rendered UI primitives.
 *
 * Plugins describe UI as data; the OR3 host renders it with its own components.
 * There is no DOM access, no Vue/component transfer and no event-handler
 * closure: interactions are declared as actions the host mediates.
 *
 * Node shapes mirror `shared/plugins/isolation/ui-primitives.ts` in the host.
 */

export interface PortableTextField {
    readonly type: 'field.text';
    readonly id: string;
    readonly label: string;
    readonly value?: string;
    readonly placeholder?: string;
    readonly description?: string;
    readonly required?: boolean;
}

export interface PortableTextareaField {
    readonly type: 'field.textarea';
    readonly id: string;
    readonly label: string;
    readonly value?: string;
    readonly description?: string;
    readonly rows?: number;
    readonly required?: boolean;
}

export interface PortableSelectField {
    readonly type: 'field.select';
    readonly id: string;
    readonly label: string;
    readonly value?: string;
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly description?: string;
    readonly required?: boolean;
}

export interface PortableToggleField {
    readonly type: 'field.toggle';
    readonly id: string;
    readonly label: string;
    readonly value?: boolean;
    readonly description?: string;
}

export type PortableFormField =
    | PortableTextField
    | PortableTextareaField
    | PortableSelectField
    | PortableToggleField;

export interface PortableButton {
    readonly type: 'button';
    readonly id: string;
    readonly label: string;
    readonly action: string;
    readonly variant?: 'primary' | 'secondary' | 'danger';
    readonly disabled?: boolean;
}

export interface PortableProgress {
    readonly type: 'progress';
    readonly value: number;
    readonly max?: number;
    readonly label?: string;
}

export type PortableUiNode =
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'markdown'; readonly markdown: string }
    | { readonly type: 'link'; readonly label: string; readonly href: string }
    | {
          readonly type: 'stack';
          readonly direction: 'row' | 'column';
          readonly children: readonly PortableUiNode[];
      }
    | { readonly type: 'box'; readonly children: readonly PortableUiNode[] }
    | {
          readonly type: 'form';
          readonly id: string;
          readonly children: readonly (PortableFormField | PortableButton)[];
      }
    | PortableFormField
    | PortableButton
    | PortableProgress
    | {
          readonly type: 'table';
          readonly columns: readonly { readonly key: string; readonly label: string }[];
          readonly rows: readonly Readonly<Record<string, string>>[];
          readonly caption?: string;
      }
    | {
          readonly type: 'list';
          readonly items: readonly {
              readonly label: string;
              readonly description?: string;
          }[];
          readonly ordered?: boolean;
      }
    | { readonly type: 'result'; readonly label: string; readonly text: string }
    | {
          readonly type: 'open-document';
          readonly label: string;
          readonly documentId: string;
      }
    | { readonly type: 'open-pane'; readonly label: string; readonly paneId: string };

export interface PortableUiView {
    readonly title?: string;
    readonly nodes: readonly PortableUiNode[];
}

/** Declare the host-rendered view a portable plugin contributes or returns. */
export function definePortableUi(view: PortableUiView): PortableUiView {
    return Object.freeze({ ...view, nodes: Object.freeze([...view.nodes]) });
}

export const ui = {
    text: (text: string): PortableUiNode => ({ type: 'text', text }),
    markdown: (markdown: string): PortableUiNode => ({ type: 'markdown', markdown }),
    link: (label: string, href: string): PortableUiNode => ({ type: 'link', label, href }),
    column: (...children: readonly PortableUiNode[]): PortableUiNode => ({
        type: 'stack',
        direction: 'column',
        children,
    }),
    row: (...children: readonly PortableUiNode[]): PortableUiNode => ({
        type: 'stack',
        direction: 'row',
        children,
    }),
    box: (...children: readonly PortableUiNode[]): PortableUiNode => ({ type: 'box', children }),
    textField: (
        id: string,
        label: string,
        options: Omit<PortableTextField, 'type' | 'id' | 'label'> = {}
    ): PortableTextField => ({ type: 'field.text', id, label, ...options }),
    textarea: (
        id: string,
        label: string,
        options: Omit<PortableTextareaField, 'type' | 'id' | 'label'> = {}
    ): PortableTextareaField => ({ type: 'field.textarea', id, label, ...options }),
    select: (
        id: string,
        label: string,
        options: readonly { readonly value: string; readonly label: string }[],
        extra: Omit<PortableSelectField, 'type' | 'id' | 'label' | 'options'> = {}
    ): PortableSelectField => ({ type: 'field.select', id, label, options, ...extra }),
    toggle: (
        id: string,
        label: string,
        options: Omit<PortableToggleField, 'type' | 'id' | 'label'> = {}
    ): PortableToggleField => ({ type: 'field.toggle', id, label, ...options }),
    form: (
        id: string,
        children: readonly (PortableFormField | PortableButton)[]
    ): PortableUiNode => ({ type: 'form', id, children }),
    button: (
        id: string,
        label: string,
        action: string,
        options: { readonly variant?: PortableButton['variant']; readonly disabled?: boolean } = {}
    ): PortableButton => ({ type: 'button', id, label, action, ...options }),
    progress: (value: number, options: { readonly max?: number; readonly label?: string } = {}): PortableProgress => ({
        type: 'progress',
        value,
        ...options,
    }),
    table: (
        columns: readonly { readonly key: string; readonly label: string }[],
        rows: readonly Readonly<Record<string, string>>[],
        caption?: string
    ): PortableUiNode => ({ type: 'table', columns, rows, ...(caption ? { caption } : {}) }),
    list: (
        items: readonly { readonly label: string; readonly description?: string }[],
        ordered = false
    ): PortableUiNode => ({ type: 'list', items, ...(ordered ? { ordered: true } : {}) }),
    result: (label: string, text: string): PortableUiNode => ({ type: 'result', label, text }),
    openDocument: (label: string, documentId: string): PortableUiNode => ({
        type: 'open-document',
        label,
        documentId,
    }),
    openPane: (label: string, paneId: string): PortableUiNode => ({
        type: 'open-pane',
        label,
        paneId,
    }),
} as const;
