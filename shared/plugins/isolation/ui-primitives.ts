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

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

export type PortableUiNode =
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'markdown'; readonly markdown: string }
    | { readonly type: 'link'; readonly label: string; readonly href: string }
    | { readonly type: 'stack'; readonly direction: 'row' | 'column'; readonly children: readonly PortableUiNode[] }
    | { readonly type: 'box'; readonly children: readonly PortableUiNode[] }
    | { readonly type: 'form'; readonly id: string; readonly children: readonly PortableUiNode[] }
    | {
          readonly type: 'field.text';
          readonly id: string;
          readonly label: string;
          readonly value?: string;
          readonly placeholder?: string;
          readonly description?: string;
          readonly required?: boolean;
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
          readonly disabled?: boolean;
      }
    | { readonly type: 'result'; readonly label: string; readonly text: string }
    | { readonly type: 'open-document'; readonly label: string; readonly documentId: string }
    | { readonly type: 'open-pane'; readonly label: string; readonly paneId: string };

export const PORTABLE_UI_NODE_TYPES = [
    'text',
    'markdown',
    'link',
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
        case 'text': {
            const text = unwrap(boundedString(value.text, 'text'));
            if (isValidation(text)) return text;
            return { ok: true, node: { type: 'text', text } };
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
            return { ok: true, node: { type: 'form', id, children } };
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
