/**
 * @module app/composables/plugins/usePortableHostActions
 *
 * Purpose:
 * Perform the host-mediated writes a portable plugin asked for by rendering a
 * button. The click is the approval; the host asks the plugin for the exact
 * payload, validates it against hard bounds, and writes through the app's own
 * stores with the host's own target — never a plugin-named document or thread.
 *
 * Behavior:
 * - `create` writes a new document from the plugin's Markdown result.
 * - `replace` rewrites the document the surface was opened on.
 * - `continue` creates a normal chat thread whose first message is the chosen
 *   answer, then navigates to it.
 * - Every refusal is a structured result the caller can show; nothing is written.
 *
 * Constraints:
 * - Client-only (documents/chats live in the local workspace database).
 * - The plugin payload is text with bounds; Markdown is converted by the host.
 *
 * Non-Goals:
 * - Asking the user for confirmation (the surface component owns that step).
 */

import {
    HOST_ACTIONS,
    planHostAction,
    type HostActionPayload,
} from '~/utils/plugins/portable-host-actions'
import { invokePortableUiEvent } from '~/composables/plugins/portable-client-runtime'
import { createDocument, updateDocument, type CreateDocumentInput } from '~/db/documents'
import { createThread } from '~/db/threads'
import { createMessage } from '~/db/messages'
import { markdownToTipTapDoc } from '~/utils/chat/markdownToTipTapDoc'

export interface HostActionOutcome {
    readonly status: 'created-document' | 'replaced-document' | 'continued-in-chat'
    readonly documentId?: string
    readonly threadId?: string
}

export type HostActionResult =
    | { readonly ok: true; readonly outcome: HostActionOutcome }
    | { readonly ok: false; readonly code: string; readonly message: string }

export type HostActionKind = 'create-document' | 'replace-document' | 'continue-in-chat'

/**
 * Ask the plugin for the payload behind one host action. Only the payload
 * crosses; the action itself is host-owned.
 */
async function requestPayload(pluginId: string, action: string): Promise<HostActionPayload | null> {
    const response = await invokePortableUiEvent(pluginId, { action })
    if (!response || typeof response !== 'object' || Array.isArray(response)) return null
    const record = response as { title?: unknown; content?: unknown }
    if (typeof record.content !== 'string') return null
    return {
        title: typeof record.title === 'string' ? record.title : '',
        content: record.content,
    }
}

export function usePortableHostActions() {
    /**
     * Run one host action for a plugin. `selectedDocumentId` is the host
     * surface's own context (route query), not plugin input.
     */
    async function run(input: {
        readonly pluginId: string
        readonly action: string
        readonly selectedDocumentId?: string | null
    }): Promise<HostActionResult> {
        const payload = await requestPayload(input.pluginId, input.action)
        if (!payload) {
            return {
                ok: false,
                code: 'payload-required',
                message: 'The plugin returned no result to write.',
            }
        }
        const planned = planHostAction({
            action: input.action,
            payload,
            selectedDocumentId: input.selectedDocumentId ?? null,
        })
        if (!planned.ok) return planned

        try {
            if (planned.plan.kind === 'replace-document') {
                await updateDocument(planned.plan.documentId, {
                    // The editor's JSON shape is the document store's content shape.
                    content: markdownToTipTapDoc(planned.plan.content) as CreateDocumentInput['content'],
                    ...(planned.plan.title ? { title: planned.plan.title } : {}),
                })
                return {
                    ok: true,
                    outcome: { status: 'replaced-document', documentId: planned.plan.documentId },
                }
            }

            if (planned.plan.kind === 'continue-in-chat') {
                const thread = await createThread({ title: planned.plan.title })
                await createMessage({
                    thread_id: thread.id,
                    role: 'assistant',
                    index: 0,
                    data: { content: planned.plan.content, attachments: [] },
                })
                return {
                    ok: true,
                    outcome: { status: 'continued-in-chat', threadId: thread.id },
                }
            }

            const document = await createDocument({
                title: planned.plan.title,
                content: markdownToTipTapDoc(planned.plan.content) as CreateDocumentInput['content'],
            })
            return {
                ok: true,
                outcome: { status: 'created-document', documentId: document.id },
            }
        } catch (error) {
            return {
                ok: false,
                code: 'write-failed',
                message: error instanceof Error ? error.message : 'The result could not be written.',
            }
        }
    }

    return { run, actions: HOST_ACTIONS }
}
