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

/**
 * Canonical host wording for reserved actions. A plugin's own button label is
 * presentation only; the host renders and reports the operation under its own
 * name so a plugin cannot disguise a host-owned write.
 */
export const HOST_ACTION_LABELS: Readonly<Record<HostActionId, string>> = Object.freeze({
    [HOST_ACTIONS.createDocument]: 'Create document',
    [HOST_ACTIONS.replaceDocument]: 'Replace selected document',
    [HOST_ACTIONS.continueInChat]: 'Continue in chat',
});

/** The grant an approved host write requires from the current activation. */
export const HOST_ACTION_WRITE_GRANT = 'documents.write';

/** Bounds: a plugin result that a person is expected to review, not a data dump. */
export const MAX_HOST_ACTION_TITLE_CHARS = 200;
export const MAX_HOST_ACTION_CONTENT_CHARS = 64 * 1024;
/**
 * The host hands a first-action selection to a sandbox as a bounded text
 * payload. The bound is the largest selection any official product accepts, so
 * a valid workflow is never refused here and an oversized selection is refused
 * before it crosses into the worker.
 */
export const MAX_FIRST_ACTION_CONTENT_BYTES = 6000;

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
          /**
           * Always null: replacing content never renames the user's document,
           * even when the plugin suggests a title.
           */
          readonly title: null
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
                // A plugin's suggested title is not applied to an existing
                // document: the write is content-only.
                title: null,
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
 * Read the plugin's answer to a host-action payload request.
 *
 * `WorkerIsolationRuntime.callPlugin()` resolves to an RPC envelope
 * (`{ ok: true, result }` / `{ ok: false, code, message }`), never the raw
 * handler payload. Unwrapping here — and refusing a missing `result` — is what
 * keeps a successful call from looking like an empty payload.
 */
export type HostActionPayloadRead =
    | { readonly ok: true; readonly payload: HostActionPayload }
    | { readonly ok: false; readonly code: string; readonly message: string }

export function readHostActionRpcPayload(response: unknown): HostActionPayloadRead {
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
        return { ok: false, code: 'payload-required', message: 'The plugin returned no result to write.' }
    }
    const envelope = response as { ok?: unknown; result?: unknown; code?: unknown; message?: unknown }
    if (envelope.ok === false) {
        return {
            ok: false,
            code: typeof envelope.code === 'string' ? envelope.code : 'plugin-refused',
            message:
                typeof envelope.message === 'string'
                    ? envelope.message
                    : 'The plugin refused to provide a result.',
        }
    }
    const result = envelope.result
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return { ok: false, code: 'payload-required', message: 'The plugin returned no result to write.' }
    }
    const record = result as { title?: unknown; content?: unknown }
    if (typeof record.content !== 'string') {
        return { ok: false, code: 'payload-required', message: 'The plugin returned no result to write.' }
    }
    return {
        ok: true,
        payload: {
            title: typeof record.title === 'string' ? record.title : '',
            content: record.content,
        },
    }
}

/**
 * Convert a stored TipTap document into plain text for a plugin's first action.
 *
 * Deliberately structural and dependency-free: headings keep their level, list
 * items keep a marker, every other block is separated by a blank line, and hard
 * breaks become newlines, so a plugin receives readable content without the host
 * shipping an editor into the plugin surface.
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
        if (record.type === 'hardBreak') {
            parts.push('\n')
            continue
        }
        if (record.type === 'bulletList' || record.type === 'orderedList') {
            const nested = listText(record)
            if (nested.length > 0) parts.push(parts.length > 0 ? `\n${nested}` : nested)
            continue
        }
        if (Array.isArray(record.content)) {
            const nested = inlineOf(record.content)
            if (nested.length > 0) parts.push(parts.length > 0 ? `\n${nested}` : nested)
        }
    }
    return parts.join('').trim()
}

/** Render a nested list with its own markers, keeping nesting legible as text. */
function listText(list: { type?: unknown; content?: unknown }): string {
    const ordered = list.type === 'orderedList'
    const items = Array.isArray(list.content) ? list.content : []
    return items
        .map((item, index) => {
            if (!item || typeof item !== 'object') return ''
            const record = item as { content?: unknown }
            const text = Array.isArray(record.content) ? inlineOf(record.content) : ''
            return `${ordered ? `${index + 1}.` : '-'} ${text}`
        })
        .filter((line) => line.length > 0)
        .join('\n')
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
