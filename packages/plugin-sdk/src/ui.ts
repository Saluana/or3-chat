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
    /** Renders as a search input (search icon, `search` semantics). */
    readonly search?: boolean;
    readonly date?: boolean;
    /**
     * Action raised once typing settles, carrying the enclosing form's current
     * values. Use it for a live search box; omit it when the value is only read
     * when the user submits the form.
     */
    readonly onChange?: string;
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
    /**
     * Action raised when the choice changes, carrying the enclosing form's
     * current values. Use it for filters and sorts.
     */
    readonly onChange?: string;
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
    readonly icon?: 'plus' | 'search' | 'settings' | 'x' | 'trash-2' | 'check' | 'undo-2';
    readonly iconOnly?: boolean;
    /** Makes this button the native submitter of its enclosing form. */
    readonly submit?: boolean;
    readonly disabled?: boolean;
}

export interface PortableProgress {
    readonly type: 'progress';
    readonly value: number;
    readonly max?: number;
    readonly label?: string;
}

export interface PortableItem {
    readonly type: 'item';
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    /** Trailing muted value in the row, such as a time or a due date. */
    readonly meta?: string;
    readonly checked?: boolean;
    readonly selected?: boolean;
    /** Leading dot color, used by navigation rows to group lists visually. */
    readonly color?: PortableUiAccent;
    readonly badges?: readonly PortableBadge[];
    readonly action: string;
    readonly detailAction?: string;
    readonly deleteAction?: string;
    /**
     * Draws an expand/collapse chevron that raises `expandAction`, so a row can
     * reveal its children (subtasks) without also selecting itself.
     */
    readonly expandAction?: string;
    readonly expanded?: boolean;
    /** Nested rows rendered under this one (for example subtasks). */
    readonly children?: readonly PortableUiNode[];
}

export const PORTABLE_UI_TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const;
export type PortableUiTone = (typeof PORTABLE_UI_TONES)[number];
export const PORTABLE_UI_TEXT_TONES = [
    'default',
    'muted',
    'success',
    'warning',
    'danger',
] as const;
export type PortableUiTextTone = (typeof PORTABLE_UI_TEXT_TONES)[number];
export const PORTABLE_UI_ACCENTS = [
    'slate',
    'blue',
    'violet',
    'pink',
    'green',
    'amber',
    'orange',
    'red',
] as const;
export type PortableUiAccent = (typeof PORTABLE_UI_ACCENTS)[number];

export interface PortableBadge {
    readonly label: string;
    readonly tone?: PortableUiTone;
}

export interface PortableHeading {
    readonly type: 'heading';
    readonly text: string;
    readonly level?: 2 | 3;
    readonly description?: string;
    readonly meta?: string;
}

export interface PortableColumns {
    readonly type: 'columns';
    readonly layout?: 'workspace';
    readonly children: readonly PortableUiNode[];
}

export interface PortableColumn {
    readonly type: 'column';
    readonly width?: 'sm' | 'md' | 'lg' | 'fill';
    readonly children: readonly PortableUiNode[];
}

export type PortableUiNode =
    | PortableHeading
    | (PortableBadge & { readonly type: 'badge' })
    | PortableItem
    | { readonly type: 'text'; readonly text: string; readonly tone?: PortableUiTextTone }
    | { readonly type: 'markdown'; readonly markdown: string }
    | { readonly type: 'link'; readonly label: string; readonly href: string }
    | { readonly type: 'divider' }
    | PortableColumns
    | PortableColumn
    | {
          readonly type: 'stack';
          readonly direction: 'row' | 'column';
          readonly children: readonly PortableUiNode[];
      }
    | { readonly type: 'box'; readonly children: readonly PortableUiNode[] }
    | {
          readonly type: 'form';
          readonly id: string;
          /**
           * Form chrome: `card` is a framed block, `plain` an unframed vertical
           * stack, and `inline` a single row whose first control grows (a search
           * box with its submit button).
           */
          readonly layout?: 'card' | 'inline' | 'plain';
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
    readonly key?: string;
    readonly navigation?: readonly PortableUiNode[];
    readonly title?: string;
    readonly nodes: readonly PortableUiNode[];
}

/** Declare the host-rendered view a portable plugin contributes or returns. */
export function definePortableUi(view: PortableUiView): PortableUiView {
    return Object.freeze({ ...view, nodes: Object.freeze([...view.nodes]) });
}

export const ui = {
    text: (text: string): PortableUiNode => ({ type: 'text', text }),
    heading: (
        text: string,
        options: Omit<PortableHeading, 'type' | 'text'> = {}
    ): PortableHeading => ({ type: 'heading', text, level: options.level ?? 2, ...options }),
    badge: (label: string, tone?: PortableUiTone): PortableUiNode => ({
        type: 'badge',
        label,
        ...(tone === undefined ? {} : { tone }),
    }),
    divider: (): PortableUiNode => ({ type: 'divider' }),
    item: (item: Omit<PortableItem, 'type'>): PortableItem => ({ type: 'item', ...item }),
    /**
     * Multi-column band. `ui.column` is a vertical stack; `ui.cols`/`ui.col`
     * build the responsive layout bands a workspace surface needs.
     */
    cols: (
        ...children: readonly PortableUiNode[]
    ): PortableColumns => ({ type: 'columns', children }),
    col: (
        width: PortableColumn['width'],
        ...children: readonly PortableUiNode[]
    ): PortableColumn => ({ type: 'column', ...(width === undefined ? {} : { width }), children }),
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
        children: readonly (PortableFormField | PortableButton)[],
        options: { readonly layout?: 'card' | 'inline' | 'plain' } = {}
    ): PortableUiNode => ({ type: 'form', id, ...options, children }),
    button: (
        id: string,
        label: string,
        action: string,
        options: Omit<PortableButton, 'type' | 'id' | 'label' | 'action'> = {}
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
    /**
     * Host-owned navigation to a document. The host verifies the live
     * activation, its read authority and the document's presence in that
     * workspace before it navigates; it never lets the plugin navigate itself.
     */
    openDocument: (label: string, documentId: string): PortableUiNode => ({
        type: 'open-document',
        label,
        documentId,
    }),
    /**
     * Refused by the portable renderer: no host registry maps a portable pane
     * id to a navigable surface, so the host renders the control disabled with
     * an explanation instead of an enabled control that does nothing.
     */
    openPane: (label: string, paneId: string): PortableUiNode => ({
        type: 'open-pane',
        label,
        paneId,
    }),
} as const;
