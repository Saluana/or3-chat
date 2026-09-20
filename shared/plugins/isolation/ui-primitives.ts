/**
 * @module shared/plugins/isolation/ui-primitives
 *
 * Purpose:
 * The declarative, sanitized UI surface a portable plugin may hand to the host
 * for rendering. Publisher code never renders into the host document: it returns
 * data, and the host renders it with host components.
 *
 * Behavior:
 * - A closed set of primitives: layout, text, sanitized markdown, links,
 *   form fields, tables/lists, progress, buttons and open-document/open-pane.
 * - Validation rejects functions, component handles, unknown node types and
 *   oversized values with actionable codes.
 * - Markdown is rendered through a first-party sanitizer that escapes every
 *   publisher-provided character before emitting HTML.
 *
 * Constraints:
 * - No arbitrary Vue components, no editor extensions, no raw HTML pass-through.
 * - Every value length is bounded so a tree cannot flood the renderer.
 *
 * Non-Goals:
 * - Layout/theming (host components own presentation).
 * - RPC transport (see `host-rpc-broker`).
 */

export const PORTABLE_UI_MAX_TEXT_BYTES = 8 * 1024;
export const PORTABLE_UI_MAX_ITEMS = 200;
export const PORTABLE_UI_MAX_COLUMNS = 12;
export const PORTABLE_UI_MAX_OPTIONS = 100;
/** Inline status pills one row may carry. */
export const PORTABLE_UI_MAX_BADGES = 4;
/** Rows nested under one item (for example the steps of a task). */
export const PORTABLE_UI_MAX_ITEM_CHILDREN = 50;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

/**
 * Closed presentation tokens. A plugin names an intent ("warning") or an accent
 * ("violet"); the host decides the concrete color from its own theme, so a
 * publisher can never inject arbitrary CSS.
 */
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

export type PortableUiNode =
    | {
          readonly type: 'heading';
          readonly text: string;
          readonly level?: 2 | 3;
          readonly description?: string;
          readonly meta?: string;
      }
    | (PortableBadge & { readonly type: 'badge' })
    | PortableItem
    | { readonly type: 'text'; readonly text: string; readonly tone?: PortableUiTextTone }
    | { readonly type: 'markdown'; readonly markdown: string }
    | { readonly type: 'link'; readonly label: string; readonly href: string }
    | { readonly type: 'divider' }
    /**
     * Responsive multi-column band. Children are `column` nodes, each declaring
     * its own width, so the band wraps into a single column on a narrow pane.
     */
    | {
          readonly type: 'columns';
          readonly layout?: 'workspace';
          readonly children: readonly PortableUiNode[];
      }
    | {
          readonly type: 'column';
          readonly width?: 'sm' | 'md' | 'lg' | 'fill';
          readonly children: readonly PortableUiNode[];
      }
    | { readonly type: 'stack'; readonly direction: 'row' | 'column'; readonly children: readonly PortableUiNode[] }
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
          readonly children: readonly PortableUiNode[];
      }
    | {
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
           * Action raised once typing settles, carrying the enclosing form's
           * current values. Use it for a live search box instead of a submit
           * round trip per keystroke; omit it when the value is only read when
           * the user submits the form.
           */
          readonly onChange?: string;
      }
    | {
          readonly type: 'field.textarea';
          readonly id: string;
          readonly label: string;
          readonly value?: string;
          readonly description?: string;
          readonly rows?: number;
          readonly required?: boolean;
      }
    | {
          readonly type: 'field.select';
          readonly id: string;
          readonly label: string;
          readonly value?: string;
          readonly options: readonly { readonly value: string; readonly label: string }[];
          readonly description?: string;
          readonly required?: boolean;
          /**
           * Action raised when the choice changes, carrying the enclosing form's
           * current values. Use it for filters and sorts; omit it when the choice
           * is only read on submit.
           */
          readonly onChange?: string;
      }
    | {
          readonly type: 'field.toggle';
          readonly id: string;
          readonly label: string;
          readonly value?: boolean;
          readonly description?: string;
      }
    | {
          readonly type: 'table';
          readonly columns: readonly { readonly key: string; readonly label: string }[];
          readonly rows: readonly Readonly<Record<string, string>>[];
          readonly caption?: string;
      }
    | {
          readonly type: 'list';
          readonly items: readonly { readonly label: string; readonly description?: string }[];
          readonly ordered?: boolean;
      }
    | {
          readonly type: 'progress';
          readonly value: number;
          readonly max?: number;
          readonly label?: string;
      }
    | {
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
    | { readonly type: 'result'; readonly label: string; readonly text: string }
    | { readonly type: 'open-document'; readonly label: string; readonly documentId: string }
    | { readonly type: 'open-pane'; readonly label: string; readonly paneId: string };

export const PORTABLE_UI_NODE_TYPES = [
    'heading',
    'badge',
    'item',
    'text',
    'markdown',
    'link',
    'divider',
    'columns',
    'column',
    'stack',
    'box',
    'form',
    'field.text',
    'field.textarea',
    'field.select',
    'field.toggle',
    'table',
    'list',
    'progress',
    'button',
    'result',
    'open-document',
    'open-pane',
] as const;

export type PortableUiNodeType = (typeof PORTABLE_UI_NODE_TYPES)[number];

export type PortableUiValidation =
    | { readonly ok: true; readonly node: PortableUiNode }
    | { readonly ok: false; readonly code: 'ui-invalid-node'; readonly message: string };

function invalid(message: string): PortableUiValidation {
    return { ok: false, code: 'ui-invalid-node', message };
}

function utf8Bytes(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function boundedString(
    value: unknown,
    field: string,
    maxBytes = PORTABLE_UI_MAX_TEXT_BYTES
): string | PortableUiValidation {
    if (typeof value !== 'string') return invalid(`${field} must be a string`);
    if (utf8Bytes(value) > maxBytes) {
        return invalid(`${field} exceeds ${maxBytes} bytes`);
    }
    return value;
}

function boundedId(value: unknown, field: string): string | PortableUiValidation {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        return invalid(`${field} must match ${String(ID_PATTERN)}`);
    }
    return value;
}

function optionalString(
    value: unknown,
    field: string,
    maxBytes = PORTABLE_UI_MAX_TEXT_BYTES
): string | undefined | PortableUiValidation {
    if (value === undefined) return undefined;
    return boundedString(value, field, maxBytes);
}

function optionalTone(
    value: unknown,
    field: string
): PortableUiTone | undefined | PortableUiValidation {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !(PORTABLE_UI_TONES as readonly string[]).includes(value)) {
        return invalid(`${field} must be one of ${PORTABLE_UI_TONES.join('|')}`);
    }
    return value as PortableUiTone;
}

function optionalTextTone(
    value: unknown,
    field: string
): PortableUiTextTone | undefined | PortableUiValidation {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !(PORTABLE_UI_TEXT_TONES as readonly string[]).includes(value)) {
        return invalid(`${field} must be one of ${PORTABLE_UI_TEXT_TONES.join('|')}`);
    }
    return value as PortableUiTextTone;
}

function optionalAccent(
    value: unknown,
    field: string
): PortableUiAccent | undefined | PortableUiValidation {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !(PORTABLE_UI_ACCENTS as readonly string[]).includes(value)) {
        return invalid(`${field} must be one of ${PORTABLE_UI_ACCENTS.join('|')}`);
    }
    return value as PortableUiAccent;
}

/** Rebuild the bounded inline pills of one row, dropping unknown keys. */
function badgesOf(raw: unknown): readonly PortableBadge[] | undefined | PortableUiValidation {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) return invalid('item.badges must be an array');
    if (raw.length > PORTABLE_UI_MAX_BADGES) {
        return invalid(`item.badges exceeds ${PORTABLE_UI_MAX_BADGES} entries`);
    }
    const badges: PortableBadge[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null) {
            return invalid('item.badges entries must be objects');
        }
        const record = entry as Record<string, unknown>;
        const label = boundedString(record.label, 'badge.label', 64);
        if (isValidation(label)) return label;
        const tone = optionalTone(record.tone, 'badge.tone');
        if (isValidation(tone)) return tone;
        badges.push({ label, ...(tone === undefined ? {} : { tone }) });
    }
    return badges.length === 0 ? undefined : badges;
}

/** Column bands are one level deep; nested bands are not a layout primitive. */
function columnsOf(raw: unknown): readonly unknown[] | PortableUiValidation {
    if (!Array.isArray(raw) || raw.length === 0) return invalid('columns requires column children');
    if (raw.length > PORTABLE_UI_MAX_COLUMNS) {
        return invalid(`columns exceeds ${PORTABLE_UI_MAX_COLUMNS} columns`);
    }
    return raw;
}

function isValidation(value: unknown): value is PortableUiValidation {
    return typeof value === 'object' && value !== null && 'ok' in value;
}

function unwrap<T>(value: T | PortableUiValidation): T | PortableUiValidation {
    return value;
}

function childrenOf(raw: unknown): readonly unknown[] | PortableUiValidation {
    if (!Array.isArray(raw)) return invalid('children must be an array');
    if (raw.length > PORTABLE_UI_MAX_ITEMS) {
        return invalid(`children exceeds ${PORTABLE_UI_MAX_ITEMS} nodes`);
    }
    return raw;
}

/**
 * Validate one declarative UI node and rebuild it, dropping unknown keys.
 * Functions, component handles and unknown types are rejected.
 */
export function validatePortableUiNode(raw: unknown): PortableUiValidation {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return invalid('UI node must be an object');
    }
    const value = raw as Record<string, unknown>;
    if ('onClick' in value || 'component' in value || 'render' in value) {
        return invalid('function, component and render handles are not allowed');
    }

    switch (value.type) {
        case 'heading': {
            const text = unwrap(boundedString(value.text, 'heading.text', 512));
            if (isValidation(text)) return text;
            if (value.level !== undefined && value.level !== 2 && value.level !== 3) return invalid('heading.level must be 2 or 3');
            const description = unwrap(optionalString(value.description, 'heading.description', 1024));
            if (isValidation(description)) return description;
            const meta = unwrap(optionalString(value.meta, 'heading.meta', 256));
            if (isValidation(meta)) return meta;
            return {ok:true,node:{type:'heading',text,level:value.level ?? 2,
                ...(description === undefined ? {} : {description}),
                ...(meta === undefined ? {} : {meta}),
            }};
        }
        case 'badge': {
            const label = unwrap(boundedString(value.label, 'badge.label', 64));
            if (isValidation(label)) return label;
            const tone = unwrap(optionalTone(value.tone, 'badge.tone'));
            if (isValidation(tone)) return tone;
            return {ok:true,node:{type:'badge',label,...(tone === undefined ? {} : {tone})}};
        }
        case 'divider': {
            return {ok:true,node:{type:'divider'}};
        }
        case 'columns': {
            const rawChildren = columnsOf(value.children);
            if (isValidation(rawChildren)) return rawChildren;
            const children: PortableUiNode[] = [];
            for (const child of rawChildren) {
                const nested = validatePortableUiNode(child);
                if (!nested.ok) return nested;
                if (nested.node.type !== 'column') {
                    return invalid('columns children must be column nodes');
                }
                children.push(nested.node);
            }
            if (value.layout !== undefined && value.layout !== 'workspace') return invalid('Invalid columns layout');
            return {ok:true,node:{type:'columns',children,...(value.layout === 'workspace' ? {layout:'workspace' as const} : {})}};
        }
        case 'column': {
            if (
                value.width !== undefined &&
                value.width !== 'sm' &&
                value.width !== 'md' &&
                value.width !== 'lg' &&
                value.width !== 'fill'
            ) {
                return invalid('column.width must be sm|md|lg|fill');
            }
            const rawChildren = childrenOf(value.children);
            if (isValidation(rawChildren)) return rawChildren;
            const children: PortableUiNode[] = [];
            for (const child of rawChildren) {
                const nested = validatePortableUiNode(child);
                if (!nested.ok) return nested;
                children.push(nested.node);
            }
            return {
                ok: true,
                node: {
                    type: 'column',
                    ...(value.width === undefined ? {} : {width: value.width as 'sm' | 'md' | 'lg' | 'fill'}),
                    children,
                },
            };
        }
        case 'item': {
            const id = unwrap(boundedId(value.id, 'item.id'));
            const label = unwrap(boundedString(value.label, 'item.label', 512));
            const action = unwrap(boundedString(value.action, 'item.action', 256));
            if (isValidation(id)) return id;
            if (isValidation(label)) return label;
            if (isValidation(action)) return action;
            if (value.selected !== undefined && typeof value.selected !== 'boolean') return invalid('item.selected must be boolean');
            if (value.checked !== undefined && typeof value.checked !== 'boolean') return invalid('item.checked must be boolean');
            const description = value.description === undefined ? undefined : unwrap(boundedString(value.description, 'item.description', 1024));
            if (description !== undefined && isValidation(description)) return description;
            const meta = unwrap(optionalString(value.meta, 'item.meta', 256));
            if (isValidation(meta)) return meta;
            const color = unwrap(optionalAccent(value.color, 'item.color'));
            if (isValidation(color)) return color;
            const badges = unwrap(badgesOf(value.badges));
            if (isValidation(badges)) return badges;
            const detailAction = value.detailAction === undefined ? undefined : unwrap(boundedString(value.detailAction, 'item.detailAction', 256));
            if (detailAction !== undefined && isValidation(detailAction)) return detailAction;
            const deleteAction = value.deleteAction === undefined ? undefined : unwrap(boundedString(value.deleteAction, 'item.deleteAction', 256));
            if (deleteAction !== undefined && isValidation(deleteAction)) return deleteAction;
            const expandAction = value.expandAction === undefined ? undefined : unwrap(boundedString(value.expandAction, 'item.expandAction', 256));
            if (expandAction !== undefined && isValidation(expandAction)) return expandAction;
            if (value.expanded !== undefined && typeof value.expanded !== 'boolean') {
                return invalid('item.expanded must be boolean');
            }
            const children = {
                ok: true,
                node: [] as PortableUiNode[],
            };
            if (value.children !== undefined) {
                if (!Array.isArray(value.children) || value.children.length > PORTABLE_UI_MAX_ITEM_CHILDREN) {
                    return invalid(`item.children exceeds ${PORTABLE_UI_MAX_ITEM_CHILDREN} nodes`);
                }
                for (const child of value.children) {
                    const nested = validatePortableUiNode(child);
                    if (!nested.ok) return nested;
                    children.node.push(nested.node);
                }
            }
            return {ok:true,node:{type:'item',id,label,action,
                ...(description === undefined ? {} : {description}),
                ...(meta === undefined ? {} : {meta}),
                ...(color === undefined ? {} : {color}),
                ...(badges === undefined ? {} : {badges}),
                ...(detailAction === undefined ? {} : {detailAction}),
                ...(deleteAction === undefined ? {} : {deleteAction}),
                ...(expandAction === undefined ? {} : {expandAction}),
                ...(value.expanded === undefined ? {} : {expanded: value.expanded}),
                ...(value.selected === undefined ? {} : {selected:value.selected}),
                ...(value.checked === undefined ? {} : {checked:value.checked}),
                ...(children.node.length === 0 ? {} : {children:children.node}),
            }};
        }
        case 'text': {
            const text = unwrap(boundedString(value.text, 'text'));
            if (isValidation(text)) return text;
            const tone = unwrap(optionalTextTone(value.tone, 'text.tone'));
            if (isValidation(tone)) return tone;
            return { ok: true, node: { type: 'text', text, ...(tone === undefined ? {} : {tone}) } };
        }
        case 'markdown': {
            const markdown = unwrap(boundedString(value.markdown, 'markdown'));
            if (isValidation(markdown)) return markdown;
            return { ok: true, node: { type: 'markdown', markdown } };
        }
        case 'link': {
            const label = unwrap(boundedString(value.label, 'label', 512));
            if (isValidation(label)) return label;
            const href = unwrap(boundedString(value.href, 'href', 2048));
            if (isValidation(href)) return href;
            if (!/^https:\/\//.test(href)) {
                return invalid('link href must be an https URL');
            }
            return { ok: true, node: { type: 'link', label, href } };
        }
        case 'stack': {
            if (value.direction !== 'row' && value.direction !== 'column') {
                return invalid('stack.direction must be row|column');
            }
            const rawChildren = childrenOf(value.children);
            if (isValidation(rawChildren)) return rawChildren;
            const children: PortableUiNode[] = [];
            for (const child of rawChildren) {
                const nested = validatePortableUiNode(child);
                if (!nested.ok) return nested;
                children.push(nested.node);
            }
            return { ok: true, node: { type: 'stack', direction: value.direction, children } };
        }
        case 'box': {
            const rawChildren = childrenOf(value.children);
            if (isValidation(rawChildren)) return rawChildren;
            const children: PortableUiNode[] = [];
            for (const child of rawChildren) {
                const nested = validatePortableUiNode(child);
                if (!nested.ok) return nested;
                children.push(nested.node);
            }
            return { ok: true, node: { type: 'box', children } };
        }
        case 'form': {
            const id = unwrap(boundedId(value.id, 'form.id'));
            if (isValidation(id)) return id;
            if (
                value.layout !== undefined &&
                value.layout !== 'card' &&
                value.layout !== 'inline' &&
                value.layout !== 'plain'
            ) {
                return invalid('form.layout must be card|inline|plain');
            }
            const rawChildren = childrenOf(value.children);
            if (isValidation(rawChildren)) return rawChildren;
            const children: PortableUiNode[] = [];
            for (const child of rawChildren) {
                const nested = validatePortableUiNode(child);
                if (!nested.ok) return nested;
                if (!String(nested.node.type).startsWith('field.') && nested.node.type !== 'button') {
                    return invalid('form children must be fields or buttons');
                }
                children.push(nested.node);
            }
            return {
                ok: true,
                node: {
                    type: 'form',
                    id,
                    ...(value.layout === undefined ? {} : { layout: value.layout as 'card' | 'inline' | 'plain' }),
                    children,
                },
            };
        }
        case 'field.text':
        case 'field.textarea': {
            const id = unwrap(boundedId(value.id, 'field.id'));
            if (isValidation(id)) return id;
            const label = unwrap(boundedString(value.label, 'field.label', 512));
            if (isValidation(label)) return label;
            const fieldValue = unwrap(optionalString(value.value, 'field.value'));
            if (isValidation(fieldValue)) return fieldValue;
            const description = unwrap(optionalString(value.description, 'field.description'));
            if (isValidation(description)) return description;
            const required = value.required === undefined ? undefined : value.required === true;
            if (value.type === 'field.text') {
                const placeholder = unwrap(optionalString(value.placeholder, 'field.placeholder'));
                if (isValidation(placeholder)) return placeholder;
                const onChange = unwrap(
                    value.onChange === undefined ? undefined : boundedId(value.onChange, 'field.text.onChange')
                );
                if (isValidation(onChange)) return onChange;
                return {
                    ok: true,
                    node: {
                        type: 'field.text',
                        id,
                        label,
                        ...(fieldValue === undefined ? {} : { value: fieldValue }),
                        ...(placeholder === undefined ? {} : { placeholder }),
                        ...(description === undefined ? {} : { description }),
                        ...(required === undefined ? {} : { required }),
                        ...(value.search === true ? { search: true } : {}),
                        ...(value.date === true ? { date: true } : {}),
                        ...(onChange === undefined ? {} : { onChange }),
                    },
                };
            }
            const rows =
                value.rows === undefined
                    ? undefined
                    : Math.min(20, Math.max(1, Math.trunc(Number(value.rows) || 4)));
            return {
                ok: true,
                node: {
                    type: 'field.textarea',
                    id,
                    label,
                    ...(fieldValue === undefined ? {} : { value: fieldValue }),
                    ...(description === undefined ? {} : { description }),
                    ...(rows === undefined ? {} : { rows }),
                    ...(required === undefined ? {} : { required }),
                },
            };
        }
        case 'field.select': {
            const id = unwrap(boundedId(value.id, 'field.id'));
            if (isValidation(id)) return id;
            const label = unwrap(boundedString(value.label, 'field.label', 512));
            if (isValidation(label)) return label;
            if (!Array.isArray(value.options) || value.options.length === 0) {
                return invalid('field.select requires options');
            }
            if (value.options.length > PORTABLE_UI_MAX_OPTIONS) {
                return invalid(`field.select options exceed ${PORTABLE_UI_MAX_OPTIONS}`);
            }
            const options: Array<{ value: string; label: string }> = [];
            for (const option of value.options) {
                if (typeof option !== 'object' || option === null) {
                    return invalid('field.select options must be objects');
                }
                const record = option as Record<string, unknown>;
                const optionValue = unwrap(boundedString(record.value, 'option.value', 512));
                if (isValidation(optionValue)) return optionValue;
                const optionLabel = unwrap(boundedString(record.label, 'option.label', 512));
                if (isValidation(optionLabel)) return optionLabel;
                options.push({ value: optionValue, label: optionLabel });
            }
            const fieldValue = unwrap(optionalString(value.value, 'field.value'));
            if (isValidation(fieldValue)) return fieldValue;
            const description = unwrap(optionalString(value.description, 'field.description'));
            if (isValidation(description)) return description;
            const onChange = unwrap(
                value.onChange === undefined ? undefined : boundedId(value.onChange, 'field.select.onChange')
            );
            if (isValidation(onChange)) return onChange;
            return {
                ok: true,
                node: {
                    type: 'field.select',
                    id,
                    label,
                    options,
                    ...(fieldValue === undefined ? {} : { value: fieldValue }),
                    ...(description === undefined ? {} : { description }),
                    ...(value.required === true ? { required: true } : {}),
                    ...(onChange === undefined ? {} : { onChange }),
                },
            };
        }
        case 'field.toggle': {
            const id = unwrap(boundedId(value.id, 'field.id'));
            if (isValidation(id)) return id;
            const label = unwrap(boundedString(value.label, 'field.label', 512));
            if (isValidation(label)) return label;
            const description = unwrap(optionalString(value.description, 'field.description'));
            if (isValidation(description)) return description;
            return {
                ok: true,
                node: {
                    type: 'field.toggle',
                    id,
                    label,
                    ...(value.value === undefined ? {} : { value: value.value === true }),
                    ...(description === undefined ? {} : { description }),
                },
            };
        }
        case 'table': {
            if (!Array.isArray(value.columns) || value.columns.length === 0) {
                return invalid('table requires columns');
            }
            if (value.columns.length > PORTABLE_UI_MAX_COLUMNS) {
                return invalid(`table columns exceed ${PORTABLE_UI_MAX_COLUMNS}`);
            }
            const columns: Array<{ key: string; label: string }> = [];
            for (const column of value.columns) {
                if (typeof column !== 'object' || column === null) {
                    return invalid('table columns must be objects');
                }
                const record = column as Record<string, unknown>;
                const key = unwrap(boundedString(record.key, 'column.key', 64));
                if (isValidation(key)) return key;
                const label = unwrap(boundedString(record.label, 'column.label', 512));
                if (isValidation(label)) return label;
                columns.push({ key, label });
            }
            if (!Array.isArray(value.rows)) return invalid('table requires rows');
            if (value.rows.length > PORTABLE_UI_MAX_ITEMS) {
                return invalid(`table rows exceed ${PORTABLE_UI_MAX_ITEMS}`);
            }
            const rows: Array<Record<string, string>> = [];
            for (const row of value.rows) {
                if (typeof row !== 'object' || row === null) {
                    return invalid('table rows must be objects');
                }
                const record = row as Record<string, unknown>;
                const projected: Record<string, string> = {};
                for (const column of columns) {
                    const cell = record[column.key];
                    if (cell === undefined || cell === null) {
                        projected[column.key] = '';
                        continue;
                    }
                    const text = String(cell);
                    if (utf8Bytes(text) > PORTABLE_UI_MAX_TEXT_BYTES) {
                        return invalid(`table cell ${column.key} is too large`);
                    }
                    projected[column.key] = text;
                }
                rows.push(projected);
            }
            const caption = unwrap(optionalString(value.caption, 'table.caption', 512));
            if (isValidation(caption)) return caption;
            return {
                ok: true,
                node: {
                    type: 'table',
                    columns,
                    rows,
                    ...(caption === undefined ? {} : { caption }),
                },
            };
        }
        case 'list': {
            if (!Array.isArray(value.items)) return invalid('list requires items');
            if (value.items.length > PORTABLE_UI_MAX_ITEMS) {
                return invalid(`list items exceed ${PORTABLE_UI_MAX_ITEMS}`);
            }
            const items: Array<{ label: string; description?: string }> = [];
            for (const item of value.items) {
                if (typeof item !== 'object' || item === null) {
                    return invalid('list items must be objects');
                }
                const record = item as Record<string, unknown>;
                const label = unwrap(boundedString(record.label, 'item.label', 512));
                if (isValidation(label)) return label;
                const description = unwrap(
                    optionalString(record.description, 'item.description')
                );
                if (isValidation(description)) return description;
                items.push({
                    label,
                    ...(description === undefined ? {} : { description }),
                });
            }
            return {
                ok: true,
                node: {
                    type: 'list',
                    items,
                    ...(value.ordered === true ? { ordered: true } : {}),
                },
            };
        }
        case 'progress': {
            const numeric = Number(value.value);
            if (!Number.isFinite(numeric)) return invalid('progress.value must be a number');
            const max = value.max === undefined ? 100 : Number(value.max);
            if (!Number.isFinite(max) || max <= 0) {
                return invalid('progress.max must be a positive number');
            }
            const label = unwrap(optionalString(value.label, 'progress.label', 512));
            if (isValidation(label)) return label;
            return {
                ok: true,
                node: {
                    type: 'progress',
                    value: Math.max(0, Math.min(numeric, max)),
                    max,
                    ...(label === undefined ? {} : { label }),
                },
            };
        }
        case 'button': {
            const icons = ['plus', 'search', 'settings', 'x', 'trash-2', 'check', 'undo-2'] as const;
            if (value.icon !== undefined && !icons.includes(value.icon as typeof icons[number])) return invalid('Invalid button icon');
            const id = unwrap(boundedId(value.id, 'button.id'));
            if (isValidation(id)) return id;
            const label = unwrap(boundedString(value.label, 'button.label', 512));
            if (isValidation(label)) return label;
            const action = unwrap(boundedId(value.action, 'button.action'));
            if (isValidation(action)) return action;
            const variant =
                value.variant === 'primary' ||
                value.variant === 'secondary' ||
                value.variant === 'danger'
                    ? value.variant
                    : undefined;
            return {
                ok: true,
                node: {
                    type: 'button',
                    id,
                    label,
                    action,
                    ...(variant === undefined ? {} : { variant }),
                    ...(value.icon === undefined ? {} : { icon: value.icon as typeof icons[number] }),
                    ...(value.iconOnly === true && value.icon ? { iconOnly: true } : {}),
                    ...(value.submit === true ? { submit: true } : {}),
                    ...(value.disabled === true ? { disabled: true } : {}),
                },
            };
        }
        case 'result': {
            const label = unwrap(boundedString(value.label, 'result.label', 512));
            if (isValidation(label)) return label;
            const text = unwrap(boundedString(value.text, 'result.text'));
            if (isValidation(text)) return text;
            return { ok: true, node: { type: 'result', label, text } };
        }
        case 'open-document': {
            const label = unwrap(boundedString(value.label, 'open-document.label', 512));
            if (isValidation(label)) return label;
            const documentId = unwrap(boundedId(value.documentId, 'open-document.documentId'));
            if (isValidation(documentId)) return documentId;
            return { ok: true, node: { type: 'open-document', label, documentId } };
        }
        case 'open-pane': {
            const label = unwrap(boundedString(value.label, 'open-pane.label', 512));
            if (isValidation(label)) return label;
            const paneId = unwrap(boundedId(value.paneId, 'open-pane.paneId'));
            if (isValidation(paneId)) return paneId;
            return { ok: true, node: { type: 'open-pane', label, paneId } };
        }
        default:
            return invalid(`Unsupported UI node type: ${String(value.type)}`);
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Minimal, first-party markdown subset: paragraphs, line breaks, bold, italic,
 * inline code, `-`/`1.` lists and https links. Every publisher character is
 * escaped first, so the returned HTML cannot contain publisher markup.
 */
export function renderSanitizedMarkdown(markdown: string): string {
    const escaped = escapeHtml(markdown);
    const blocks = escaped.split(/\n{2,}/);

    const renderInline = (text: string): string =>
        text
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
            .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer nofollow" target="_blank">$1</a>')
            .replace(/\n/g, '<br>');

    return blocks
        .map((block) => {
            const lines = block.split('\n');
            const isBullet = lines.every((line) => /^-\s+/.test(line));
            const isOrdered = lines.every((line) => /^\d+\.\s+/.test(line));
            if (isBullet) {
                return `<ul>${lines
                    .map((line) => `<li>${renderInline(line.replace(/^-\s+/, ''))}</li>`)
                    .join('')}</ul>`;
            }
            if (isOrdered) {
                return `<ol>${lines
                    .map((line) =>
                        `<li>${renderInline(line.replace(/^\d+\.\s+/, ''))}</li>`
                    )
                    .join('')}</ol>`;
            }
            return `<p>${renderInline(block)}</p>`;
        })
        .join('');
}

/** Host-mediated events a rendered tree can raise. */
export type PortableUiEvent =
    | {
          readonly kind: 'action';
          readonly action: string;
          readonly formId?: string;
          readonly values: Readonly<Record<string, string | boolean>>;
      }
    | { readonly kind: 'open-document'; readonly documentId: string }
    | { readonly kind: 'open-pane'; readonly paneId: string };
