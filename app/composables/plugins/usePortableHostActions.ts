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
 * - `replace` rewrites the document the surface was opened on, only after the
 *   user confirms the exact payload the host planned.
 * - `continue` creates a normal chat thread whose first message is the chosen
 *   answer, then navigates to it.
 * - Every input the plugin answers with is unwrapped from the RPC envelope, so
 *   a successful call cannot be mistaken for an empty payload.
 * - A write requires the activation to currently hold the write grant, is
 *   pinned to the workspace/database captured at admission, and re-checks the
 *   activation identity at execution, so a workspace switch or reactivation
 *   cannot redirect or split a write.
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
    HOST_ACTION_WRITE_GRANT,
    planHostAction,
    readHostActionRpcPayload,
    type HostActionPayload,
    type HostActionPlan,
} from '~/utils/plugins/portable-host-actions'
import {
    getPortableActivation,
    invokePortableUiEvent,
} from '~/composables/plugins/portable-client-runtime'
import {
    createDocumentInDb,
    getDocumentInDb,
    updateDocumentInDb,
    type CreateDocumentInput,
    type DocumentRecord,
} from '~/db/documents'
import { getWorkspaceDb } from '~/db/client'
import { createThreadInDb } from '~/db/threads'
import { createMessageInDb } from '~/db/messages'
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
 * A host action validated and frozen at admission: the exact payload, target
 * document revision and activation identity the user is approving. Execution
 * never re-reads any of them from plugin state.
 */
export interface PreparedHostAction {
    readonly action: string
    readonly plan: HostActionPlan
    readonly pluginId: string
    readonly workspaceId: string
    readonly generation: number
    /** Content revision of the replace target; null for other actions. */
    readonly documentRevision: string | null
    readonly requiresConfirmation: boolean
}

export type HostActionPrepareResult =
    | { readonly ok: true; readonly prepared: PreparedHostAction }
    | { readonly ok: false; readonly code: string; readonly message: string }

function failure(code: string, message: string): { ok: false; code: string; message: string } {
    return { ok: false, code, message }
}

/** Exact content identity of a replace target at admission. */
function documentRevision(record: DocumentRecord): string {
    return `${record.updated_at}\u0000${record.title}\u0000${JSON.stringify(record.content ?? null)}`
}

/** Ask the plugin for the payload behind one host action. */
async function requestPayload(
    pluginId: string,
    action: string
): Promise<{ ok: true; payload: HostActionPayload } | { ok: false; code: string; message: string }> {
    let response: unknown
    try {
        response = await invokePortableUiEvent(pluginId, { action })
    } catch (error) {
        return failure(
            'plugin-inactive',
            error instanceof Error ? error.message : 'The plugin is not active.'
        )
    }
    return readHostActionRpcPayload(response)
}

export function usePortableHostActions() {
    /**
     * Validate one host action and freeze everything execution needs. The
     * plugin may render interactively while a confirmation is shown; execution
     * uses only this frozen plan.
     */
    async function prepare(input: {
        readonly pluginId: string
        readonly action: string
        readonly selectedDocumentId?: string | null
    }): Promise<HostActionPrepareResult> {
        const activation = getPortableActivation(input.pluginId)
        if (!activation || activation.status !== 'active') {
            return failure('plugin-inactive', 'The plugin is not running.')
        }
        if (!activation.approvedGrants.includes(HOST_ACTION_WRITE_GRANT)) {
            return failure(
                'write-authority-required',
                'This plugin has not been approved to create or replace documents.'
            )
        }

        const payload = await requestPayload(input.pluginId, input.action)
        if (!payload.ok) return payload

        const planned = planHostAction({
            action: input.action,
            payload: payload.payload,
            selectedDocumentId: input.selectedDocumentId ?? null,
        })
        if (!planned.ok) return planned

        let revision: string | null = null
        if (planned.plan.kind === 'replace-document') {
            const db = getWorkspaceDb(activation.workspaceId)
            const existing = await getDocumentInDb(db, planned.plan.documentId)
            if (!existing) {
                return failure(
                    'stale-target',
                    'The document this plugin was opened on no longer exists.'
                )
            }
            revision = documentRevision(existing)
        }

        return {
            ok: true,
            prepared: {
                action: input.action,
                plan: planned.plan,
                pluginId: input.pluginId,
                workspaceId: activation.workspaceId,
                generation: activation.generation,
                documentRevision: revision,
                requiresConfirmation: planned.plan.requiresConfirmation,
            },
        }
    }

    /**
     * Execute an exact, previously prepared action. Re-checks the activation
     * identity and the write grant, and (for a replacement) the target revision,
     * then performs every related write against the workspace database captured
     * at admission.
     */
    async function execute(prepared: PreparedHostAction): Promise<HostActionResult> {
        const activation = getPortableActivation(prepared.pluginId)
        if (
            !activation ||
            activation.status !== 'active' ||
            activation.workspaceId !== prepared.workspaceId ||
            activation.generation !== prepared.generation
        ) {
            return failure(
                'activation-changed',
                'The plugin was restarted or the workspace changed; nothing was written.'
            )
        }
        if (!activation.approvedGrants.includes(HOST_ACTION_WRITE_GRANT)) {
            return failure(
                'write-authority-required',
                'This plugin is no longer approved to write documents.'
            )
        }

        const db = getWorkspaceDb(prepared.workspaceId)

        try {
            if (prepared.plan.kind === 'replace-document') {
                const existing = await getDocumentInDb(db, prepared.plan.documentId)
                if (!existing || documentRevision(existing) !== prepared.documentRevision) {
                    return failure(
                        'stale-target',
                        'The document changed while this result was being prepared; nothing was written.'
                    )
                }
                const updated = await updateDocumentInDb(db, prepared.plan.documentId, {
                    // Content-only: an approved replace never renames the document.
                    content: markdownToTipTapDoc(prepared.plan.content) as CreateDocumentInput['content'],
                })
                if (!updated) {
                    return failure(
                        'stale-target',
                        'The document this plugin was opened on no longer exists.'
                    )
                }
                return {
                    ok: true,
                    outcome: { status: 'replaced-document', documentId: updated.id },
                }
            }

            if (prepared.plan.kind === 'continue-in-chat') {
                const thread = await createThreadInDb(db, { title: prepared.plan.title })
                await createMessageInDb(db, {
                    thread_id: thread.id,
                    role: 'assistant',
                    index: 0,
                    data: { content: prepared.plan.content, attachments: [] },
                })
                return {
                    ok: true,
                    outcome: { status: 'continued-in-chat', threadId: thread.id },
                }
            }

            const document = await createDocumentInDb(db, {
                title: prepared.plan.title,
                content: markdownToTipTapDoc(prepared.plan.content) as CreateDocumentInput['content'],
            })
            return {
                ok: true,
                outcome: { status: 'created-document', documentId: document.id },
            }
        } catch (error) {
            return failure(
                'write-failed',
                error instanceof Error ? error.message : 'The result could not be written.'
            )
        }
    }

    /**
     * Prepare and immediately execute an action that needs no confirmation.
     * Actions that require confirmation must use `prepare`/`execute` around the
     * user's explicit approval.
     */
    async function run(input: {
        readonly pluginId: string
        readonly action: string
        readonly selectedDocumentId?: string | null
    }): Promise<HostActionResult> {
        const prepared = await prepare(input)
        if (!prepared.ok) return prepared
        return await execute(prepared.prepared)
    }

    return { prepare, execute, run }
}
