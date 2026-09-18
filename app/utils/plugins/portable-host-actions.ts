/**
 * @module app/utils/plugins/portable-host-actions
 *
 * Purpose:
 * The host-mediated actions a portable plugin may ask for by rendering a button:
 * create a new document from its result, replace the selected document, or
 * continue the chosen answer in a normal chat. Plugin output is data; only a
 * user click on a host-rendered button starts an action, and the host composes
 * the write itself.
 *
 * Behavior:
 * - Reserved action ids (`host.`) are handled by the host and never forwarded to
 *   the plugin as UI events; an unknown reserved id is refused rather than
 *   silently ignored.
 * - The plugin supplies the *payload* (title/content) and the host validates it
 *   against hard bounds before touching any store.
 * - Replacing content is allowed only when the surface was opened on a selected
 *   document, and only after an explicit confirmation; the target is that
 *   selection, never an id a plugin names.
 *
 * Constraints:
 * - Pure validation/planning: no stores, no network, no Vue. The caller performs
 *   the write so this can be tested without the app database.
 *
 * Non-Goals:
 * - Rendering the confirmation UI (the surface component owns that).
 */

export const HOST_ACTION_PREFIX = 'host.';

export const HOST_ACTIONS = {
    createDocument: 'host.document.create',
    replaceDocument: 'host.document.replace',
    continueInChat: 'host.chat.continue',
} as const;

export type HostActionId = (typeof HOST_ACTIONS)[keyof typeof HOST_ACTIONS];

const HOST_ACTION_IDS: readonly string[] = Object.values(HOST_ACTIONS);

/** Bounds: a plugin result that a person is expected to review, not a data dump. */
export const MAX_HOST_ACTION_TITLE_CHARS = 200;
export const MAX_HOST_ACTION_CONTENT_CHARS = 64 * 1024;

export function isHostAction(action: string): boolean {
    return action.startsWith(HOST_ACTION_PREFIX);
}

export function isKnownHostAction(action: string): action is HostActionId {
    return HOST_ACTION_IDS.includes(action);
}

export interface HostActionPayload {
    readonly title: string;
    readonly content: string;
}

export type HostActionPlan =
    | {
          readonly kind: 'create-document'
          readonly title: string
          readonly content: string
          readonly requiresConfirmation: false
      }
    | {
          readonly kind: 'replace-document'
          readonly documentId: string
          readonly title: string | null
          readonly content: string
          readonly requiresConfirmation: true
      }
    | {
          readonly kind: 'continue-in-chat'
          readonly title: string
          readonly content: string
          readonly requiresConfirmation: false
      }

export type HostActionResult =
    | { readonly ok: true; readonly plan: HostActionPlan }
    | { readonly ok: false; readonly code: string; readonly message: string }

function readText(value: unknown, maxChars: number): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > maxChars) return null
    return trimmed
}

/**
 * Validate the payload a plugin returned for an approved action and decide what
 * the host should do. `selectedDocumentId` comes from the host surface's own
 * context; it is never read from the plugin payload.
 */
export function planHostAction(input: {
    readonly action: string
    readonly payload: unknown
    readonly selectedDocumentId?: string | null
}): HostActionResult {
    if (!isKnownHostAction(input.action)) {
        return { ok: false, code: 'unknown-host-action', message: 'The host does not provide that action.' }
    }
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
        return { ok: false, code: 'payload-required', message: 'The plugin returned no result to write.' }
    }
    const raw = input.payload as { title?: unknown; content?: unknown }
    const title = readText(raw.title, MAX_HOST_ACTION_TITLE_CHARS)
    const content = readText(raw.content, MAX_HOST_ACTION_CONTENT_CHARS)
    if (!content) {
        return {
            ok: false,
            code: 'content-required',
            message: `The result must be 1–${MAX_HOST_ACTION_CONTENT_CHARS} characters of text.`,
        }
    }

    if (input.action === HOST_ACTIONS.replaceDocument) {
        const documentId = typeof input.selectedDocumentId === 'string' ? input.selectedDocumentId : ''
        if (!documentId) {
            return {
                ok: false,
                code: 'selection-required',
                message: 'Open this plugin from a document selection to replace it.',
            }
        }
        return {
            ok: true,
            plan: {
                kind: 'replace-document',
                documentId,
                title,
                content,
                requiresConfirmation: true,
            },
        }
    }

    if (input.action === HOST_ACTIONS.continueInChat) {
        return {
            ok: true,
            plan: {
                kind: 'continue-in-chat',
                title: title ?? chatTitleFrom(content),
                content,
                requiresConfirmation: false,
            },
        }
    }

    return {
        ok: true,
        plan: {
            kind: 'create-document',
            title: title ?? 'Plugin result',
            content,
            requiresConfirmation: false,
        },
    }
}

/**
 * Convert a stored TipTap document into plain text for a plugin's first action.
 *
 * Deliberately structural and dependency-free: headings keep their level, list
 * items keep a marker, and every other block is separated by a blank line, so a
 * plugin receives readable content without the host shipping an editor into the
 * plugin surface.
 */
export function tipTapToText(node: unknown): string {
    const lines: string[] = []
    collectText(node, lines)
    return lines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function collectText(node: unknown, lines: string[]): void {
    if (!node || typeof node !== 'object') return
    const record = node as { type?: unknown; text?: unknown; content?: unknown; attrs?: unknown }
    const type = typeof record.type === 'string' ? record.type : ''
    const children = Array.isArray(record.content) ? record.content : []

    if (type === 'text') {
        if (typeof record.text === 'string' && record.text.length > 0) {
            appendInline(lines, record.text)
        }
        return
    }
    if (type === 'heading') {
        const levelRaw = (record.attrs as { level?: unknown } | undefined)?.level
        const level = typeof levelRaw === 'number' && levelRaw >= 1 && levelRaw <= 6 ? levelRaw : 1
        lines.push(`${'#'.repeat(level)} ${inlineOf(children)}`)
        return
    }
    if (type === 'paragraph') {
        lines.push(inlineOf(children))
        return
    }
    if (type === 'listItem') {
        lines.push(`- ${inlineOf(children)}`)
        return
    }
    if (type === 'codeBlock') {
        lines.push(inlineOf(children))
        return
    }
    for (const child of children) collectText(child, lines)
}

function inlineOf(children: readonly unknown[]): string {
    const parts: string[] = []
    for (const child of children) {
        if (!child || typeof child !== 'object') continue
        const record = child as { type?: unknown; text?: unknown; content?: unknown }
        if (record.type === 'text' && typeof record.text === 'string') {
            parts.push(record.text)
            continue
        }
        if (Array.isArray(record.content)) {
            parts.push(inlineOf(record.content))
        }
    }
    return parts.join('').trim()
}

function appendInline(lines: string[], text: string): void {
    if (lines.length === 0) lines.push(text)
    else lines[lines.length - 1] = `${lines[lines.length - 1]}${text}`
}

/** Chat thread title derived from the chosen answer, bounded and single-line. */
export function chatTitleFrom(content: string, fallback = 'Continued result'): string {
    const firstLine = content.split(/\r?\n/).find((line) => line.trim().length > 0) ?? ''
    const compact = firstLine.replace(/^#+\s*/, '').trim()
    if (!compact) return fallback
    return compact.length > 60 ? `${compact.slice(0, 57)}…` : compact
}
