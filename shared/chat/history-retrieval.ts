import { readCompactionData, type CompactionData } from './compaction';
import type { CanonicalHistoryRecord } from './background-history';
import type { CanonicalChatQuery, CanonicalChatReadResult } from './history-reader';

type Row = CanonicalHistoryRecord;
type Kind = CompactionData['landmarks'][number]['kind'];
export interface HistoryRetrievalContext {
    subject: string; workspaceId: string; threadId: string; signal: AbortSignal;
    read: (query: CanonicalChatQuery) => Promise<CanonicalChatReadResult>;
    /** Current authorization/view fence, also checked immediately before returning content. */
    authorize: () => Promise<void> | void;
    revision: (threadIds?: readonly string[]) => Promise<string> | string;
}
export interface GetHistoryMessageArgs { message_id: string; include_after_compaction?: boolean }
export interface SearchParentArgs { query: string; kinds?: Kind[]; include_after_compaction?: boolean; cursor?: string }
class ScopeError extends Error {}
const bytes = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const textOf = (row: Row) => {
    const content = object(row.data).content ?? row.content;
    return typeof content === 'string' ? content : Array.isArray(content)
        ? content.map((part) => object(part)).filter((part) => part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n') : '';
};
const excerpt = (text: string, limit: number) => { const characters = Array.from(text); return { text: characters.slice(0, limit).join(''), truncated: characters.length > limit }; };
async function hash(value: unknown) {
    const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function guard(ctx: HistoryRetrievalContext) {
    if (ctx.signal.aborted) throw new DOMException('History retrieval canceled.', 'AbortError');
    await ctx.authorize();
    if (ctx.signal.aborted) throw new DOMException('History retrieval canceled.', 'AbortError');
}
async function read(ctx: HistoryRetrievalContext, query: CanonicalChatQuery) {
    await guard(ctx); const result = await ctx.read(query); await guard(ctx);
    if (result.status !== 'ok') throw new ScopeError('Canonical history is incomplete. Sync the summary and its lineage, then retry.');
    return result;
}
async function rows(ctx: HistoryRetrievalContext, ids: string[]): Promise<Row[]> {
    return (await read(ctx, { kind: 'messages', message_ids: ids })).messages ?? [];
}
async function scope(ctx: HistoryRetrievalContext) {
    await guard(ctx); const revision = await ctx.revision();
    const path: Row[] = []; const visited = new Set<string>(); let id: string | undefined = ctx.threadId;
    while (id) {
        if (path.length >= 128) throw new ScopeError('Conversation lineage exceeds the 128-link lookup bound.');
        if (visited.has(id)) throw new ScopeError('Conversation lineage is cyclic.'); visited.add(id);
        const thread: Row | undefined = (await read(ctx, { kind: 'thread', thread_id: id })).thread;
        if (!thread || thread.deleted || thread.id !== id) throw new ScopeError('Conversation ancestry is unavailable.');
        path.push(thread); id = typeof thread.parent_thread_id === 'string' && thread.parent_thread_id ? thread.parent_thread_id : undefined;
    }
    const ancestors = new Set(path.slice(1).map((row) => row.id));
    // Parent relationships, rather than a denormalized root or a landmark ID,
    // establish the only threads in which this execution can retrieve content.
    for (const child of path.slice(0, -1)) {
        if (typeof child.anchor_message_id !== 'string') throw new ScopeError('A parent edge has no persisted anchor.');
        const anchor = (await rows(ctx, [child.anchor_message_id]))[0];
        if (!anchor || anchor.deleted || anchor.thread_id !== child.parent_thread_id) throw new ScopeError('A parent anchor is unavailable.');
    }
    const boundary = path.find((thread) => thread.branch_mode === 'compacted');
    if (!boundary || typeof boundary.summary_message_id !== 'string') throw new ScopeError('No complete compaction boundary is available.');
    const memberships = new Map<string, Map<string, number>>(); const landmarks = new Map<string, Kind[]>();
    const pointers = new Set<string>(); const recipes: unknown[] = []; let summaryId: string | undefined = boundary.summary_message_id;
    while (summaryId) {
        if (pointers.size >= 128) throw new ScopeError('Captured scope exceeds the 128-link lookup bound.');
        if (pointers.has(summaryId)) throw new ScopeError('History scope references are cyclic.'); pointers.add(summaryId);
        const summary = (await rows(ctx, [summaryId]))[0];
        const owner = summary && path.find((thread) => thread.id === summary.thread_id);
        const metadata = summary && readCompactionData(object(summary.data).compaction);
        if (!summary || summary.deleted || summary.pending || summary.role !== 'system' || !owner || !metadata
            || owner.summary_message_id !== summary.id || owner.branch_mode !== 'compacted'
            || metadata.source_thread_id !== owner.parent_thread_id || metadata.anchor_message_id !== owner.anchor_message_id) {
            throw new ScopeError('A captured scope recipe is unavailable or does not belong to this lineage.');
        }
        if (bytes(metadata.history_scope) > 128 * 1024
            || metadata.history_scope.segments.reduce((count, segment) => count + segment.messages.length, 0) > 2048) {
            throw new ScopeError('A captured scope exceeds its metadata bounds.');
        }
        recipes.push({ summaryId, clock: summary.clock, metadata });
        for (const segment of metadata.history_scope.segments) {
            if (!ancestors.has(segment.thread_id)) throw new ScopeError('A captured scope refers outside the ancestor path.');
            const previous = memberships.get(segment.thread_id);
            const captured = new Map(segment.messages.map((ref) => [ref.message_id, ref.clock]));
            // An older boundary constrains an overlapping ancestor segment.
            // It cannot grant an unrelated copied/imported segment authority.
            memberships.set(segment.thread_id, previous ? new Map([...previous].filter(([key]) => captured.has(key))) : captured);
        }
        for (const landmark of metadata.landmarks) if (ancestors.has(landmark.thread_id)
            && memberships.get(landmark.thread_id)?.has(landmark.message_id)) {
            landmarks.set(landmark.message_id, [...(landmarks.get(landmark.message_id) ?? []), landmark.kind]);
        }
        summaryId = metadata.history_scope.inherited_scope_message_id;
    }
    for (const messageId of landmarks.keys()) if (![...memberships.values()].some((members) => members.has(messageId))) landmarks.delete(messageId);
    const refs = [...path].reverse().flatMap((thread) => [...(memberships.get(thread.id) ?? [])]
        .map(([messageId, clock]) => ({ threadId: thread.id, messageId, clock })));
    if (await ctx.revision() !== revision) throw new ScopeError('History changed while checking its scope. Retry explicitly.');
    // Tool-result writes in the current thread must not invalidate a search
    // continuation over its ancestors. Edits to any eligible ancestor do.
    const ancestorRevision = await ctx.revision([...ancestors].sort());
    const lineage = path.map((thread) => ({ id: thread.id, parent: thread.parent_thread_id, anchor: thread.anchor_message_id,
        mode: thread.branch_mode, summary: thread.summary_message_id, deleted: thread.deleted }));
    const identity = await hash({ subject: ctx.subject, workspace: ctx.workspaceId, thread: ctx.threadId, ancestorRevision, lineage, recipes });
    return { ancestors, memberships, landmarks, refs, identity, path, revision, ancestorRevision };
}
function permitted(state: Awaited<ReturnType<typeof scope>>, row: Row, expanded: boolean) {
    return typeof row.thread_id === 'string' && state.ancestors.has(row.thread_id)
        && (expanded || state.memberships.get(row.thread_id)?.has(row.id) === true);
}
function describe(state: Awaited<ReturnType<typeof scope>>, row: Row, limit: number) {
    const captured = state.memberships.get(String(row.thread_id))?.get(row.id);
    return { message_id: row.id, thread_id: row.thread_id, role: row.role, ...excerpt(textOf(row), limit),
        changed_since_compaction: captured !== undefined && captured !== row.clock,
        outside_compaction_scope: captured === undefined };
}

/** One registered tool service owns its cursor signing key; no history cache is introduced. */
export function createHistoryRetrievalService() {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const key = crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (character) => character.charCodeAt(0));
    async function cursor(payload: Record<string, unknown>) {
        const body = new TextEncoder().encode(JSON.stringify(payload));
        const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await key, body));
        const token = `${encode(body)}.${encode(signature)}`; if (bytes(token) > 2048) throw new ScopeError('History continuation is too large.'); return token;
    }
    async function openCursor(token: string) {
        if (bytes(token) > 2048) throw new ScopeError('History cursor is invalid.');
        try {
            const [body, signature, extra] = token.split('.');
            if (!body || !signature || extra || !await crypto.subtle.verify('HMAC', await key, decode(signature), decode(body))) throw new Error();
            return object(JSON.parse(new TextDecoder().decode(decode(body))));
        } catch { throw new ScopeError('History cursor changed or expired. Start a new search.'); }
    }
    async function getMessage(ctx: HistoryRetrievalContext, args: GetHistoryMessageArgs) {
        try {
            const state = await scope(ctx); const expanded = args.include_after_compaction === true;
            if (!expanded && !state.refs.some((ref) => ref.messageId === args.message_id)) return { status: 'out_of_scope', requested_message_id: args.message_id };
            let row = (await rows(ctx, [args.message_id]))[0];
            if (!row) return { status: expanded ? 'out_of_scope' : 'unavailable', requested_message_id: args.message_id };
            if (!permitted(state, row, expanded)) return { status: 'out_of_scope', requested_message_id: args.message_id };
            if (row.deleted) return { status: 'deleted', requested_message_id: args.message_id };
            const replacements: string[] = []; const visited = new Set<string>();
            for (let step = 0; step < 16; step++) {
                if (visited.has(row.id)) throw new ScopeError('Replacement history is cyclic.'); visited.add(row.id);
                const replacement = object(row.data).superseded_by;
                if (typeof replacement !== 'string' || !replacement) break;
                replacements.push(replacement);
                const next = (await rows(ctx, [replacement]))[0];
                if (!next || !permitted(state, next, expanded)) return { status: 'superseded', requested_message_id: args.message_id,
                    replacement_message_ids: replacements, reason: 'Replacement content is unavailable in this scope.' };
                if (next.deleted) return { status: 'deleted', requested_message_id: args.message_id, replacement_message_ids: replacements };
                row = next;
                if (step === 15 && object(row.data).superseded_by) throw new ScopeError('Replacement chain exceeds its bounded lookup.');
            }
            const position = state.refs.findIndex((ref) => ref.messageId === row.id);
            const neighbors: ReturnType<typeof describe>[] = [];
            // A removed or superseded adjacent reference is skipped, without
            // loading an unbounded conversation to discover the next neighbor.
            let neighborsIncomplete = false;
            for (const direction of [-1, 1]) {
                if (position < 0) { neighborsIncomplete = expanded; continue; }
                let found = false; let visited = 0;
                for (let offset = position + direction; offset >= 0 && offset < state.refs.length && visited < 100; offset += direction) {
                    visited++;
                    const ref = state.refs[offset]!;
                    const neighbor = (await rows(ctx, [ref.messageId]))[0];
                    if (!neighbor || neighbor.thread_id !== ref.threadId || neighbor.deleted
                        || object(neighbor.data).superseded_by || !permitted(state, neighbor, expanded)) continue;
                    neighbors.push(describe(state, neighbor, 2000)); found = true; break;
                }
                if (!found && visited === 100) neighborsIncomplete = true;
            }
            const result = { status: replacements.length ? 'superseded' : 'ok', requested_message_id: args.message_id,
                replacement_message_ids: replacements, message: describe(state, row, 8000), neighbors,
                neighbors_incomplete: neighborsIncomplete };
            while (bytes(result) > 24 * 1024 && result.neighbors.length) result.neighbors.pop();
            while (bytes(result) > 24 * 1024 && result.message.text.length) { result.message.text = Array.from(result.message.text).slice(0, -256).join(''); result.message.truncated = true; }
            if (bytes(result) > 24 * 1024) throw new ScopeError('Historical metadata exceeds its response budget.');
            await guard(ctx);
            if (await ctx.revision() !== state.revision) throw new ScopeError('History changed during lookup. Retry explicitly.');
            if (await ctx.revision([...state.ancestors].sort()) !== state.ancestorRevision) throw new ScopeError('Original history changed during lookup. Retry explicitly.');
            return result;
        } catch (error) {
            if (ctx.signal.aborted) throw error;
            return { status: 'scope_incomplete', reason: error instanceof ScopeError ? error.message : 'Historical retrieval is unavailable.' };
        }
    }
    async function searchParent(ctx: HistoryRetrievalContext, args: SearchParentArgs) {
        try {
            const query = args.query.trim().normalize('NFKC').toLowerCase();
            if (!query || Array.from(query).length > 256) throw new ScopeError('Search query must contain 1–256 characters.');
            const state = await scope(ctx); const expanded = args.include_after_compaction === true;
            const binding = await hash({ scope: state.identity, query, kinds: args.kinds ?? [], expanded });
            let position = 0; let ancestor = 0; let pageOffset = 0; let providerCursor: string | undefined;
            if (args.cursor) {
                const saved = await openCursor(args.cursor);
                if (saved.binding !== binding || typeof saved.expires !== 'number' || saved.expires < Date.now()
                    || !Number.isSafeInteger(saved.position) || Number(saved.position) < 0 || Number(saved.position) > state.refs.length
                    || !Number.isSafeInteger(saved.ancestor) || Number(saved.ancestor) < 0 || Number(saved.ancestor) >= state.path.length
                    || !Number.isSafeInteger(saved.pageOffset) || Number(saved.pageOffset) < 0 || Number(saved.pageOffset) > 100) throw new ScopeError('Scope or query changed. Start a new search.');
                position = Number(saved.position); ancestor = Number(saved.ancestor); pageOffset = Number(saved.pageOffset);
                providerCursor = typeof saved.providerCursor === 'string' ? saved.providerCursor : undefined;
            }
            const terms = [...new Set(query.split(/\s+/))]; let scanned = 0; let scannedBytes = 0; let complete = false;
            const found: Array<ReturnType<typeof describe> & { score: number; landmark: boolean; proximity: number; orderIndex: number; orderKey: string }> = [];
            while (scanned < 500 && scannedBytes < 1024 * 1024) {
                await guard(ctx); let candidates: Row[]; let pageEndCursor: string | undefined; let hitBudget = false;
                if (expanded) {
                    const thread = state.path.slice(1)[ancestor]; if (!thread) { complete = true; break; }
                    const page = await read(ctx, { kind: 'thread_page', thread_id: thread.id, cursor: providerCursor, limit: 100 });
                    candidates = (page.messages ?? []).slice(pageOffset); pageEndCursor = page.next_cursor;
                    if (!candidates.length && pageEndCursor) throw new ScopeError('Canonical history paging made no progress.');
                } else {
                    const refs = state.refs.slice(position, position + Math.min(100, 500 - scanned));
                    if (!refs.length) { complete = true; break; }
                    const available = new Map((await rows(ctx, refs.map((ref) => ref.messageId))).map((row) => [row.id, row]));
                    candidates = refs.map((ref) => available.get(ref.messageId)
                        ?? { id: ref.messageId, clock: ref.clock, thread_id: ref.threadId, deleted: true });
                }
                for (const row of candidates) {
                    const eligible = permitted(state, row, expanded) && !row.deleted && !object(row.data).superseded_by;
                    const text = eligible ? textOf(row) : ''; const size = bytes(text);
                    if (size > 1024 * 1024) throw new ScopeError('A historical row exceeds the bounded search work budget. Use its message lookup instead.');
                    if (scannedBytes + size > 1024 * 1024 || scanned >= 500) { hitBudget = true; break; }
                    scanned++; scannedBytes += size; if (expanded) pageOffset++; else position++;
                    if (!eligible) continue;
                    const kinds = [...(state.landmarks.get(row.id) ?? []), ...(row.role === 'tool' ? ['tool-result' as const] : []),
                        ...(typeof row.file_hashes === 'string' && row.file_hashes !== '[]' ? ['file' as const] : [])];
                    if (args.kinds?.length && !args.kinds.some((kind) => kinds.includes(kind))) continue;
                    const normalized = text.normalize('NFKC').toLowerCase(); const score = terms.filter((term) => normalized.includes(term)).length;
                    if (score) found.push({ ...describe(state, row, 300), score, landmark: state.landmarks.has(row.id),
                        proximity: state.path.findIndex((thread) => thread.id === row.thread_id), orderIndex: Number(row.index ?? 0), orderKey: String(row.order_key ?? '') });
                }
                if (expanded && !hitBudget) { pageOffset = 0; providerCursor = pageEndCursor; if (!providerCursor) ancestor++; }
                if (hitBudget) break;
                if (expanded ? ancestor >= state.path.length - 1 : position >= state.refs.length) { complete = true; break; }
            }
            found.sort((a, b) => Number(b.landmark) - Number(a.landmark) || b.score - a.score || a.proximity - b.proximity
                || a.orderIndex - b.orderIndex || a.orderKey.localeCompare(b.orderKey) || a.message_id.localeCompare(b.message_id));
            const results = found.slice(0, 20).map(({ score: _score, landmark: _landmark, proximity: _proximity,
                orderIndex: _index, orderKey: _key, ...row }) => row);
            const result = { status: 'ok', results, scanned_rows: scanned, scan_complete: complete,
                next_cursor: complete ? undefined : await cursor({ binding, position, ancestor, pageOffset, providerCursor, expires: Date.now() + 10 * 60 * 1000 }) };
            while (bytes(result) > 16 * 1024 && results.length) results.pop();
            await guard(ctx);
            if (await ctx.revision() !== state.revision) throw new ScopeError('History changed during search. Start a new search.');
            if (await ctx.revision([...state.ancestors].sort()) !== state.ancestorRevision) throw new ScopeError('Original history changed during search. Start a new search.');
            return result;
        } catch (error) {
            if (ctx.signal.aborted) throw error;
            return { status: 'scope_incomplete', reason: error instanceof ScopeError ? error.message : 'Historical search is unavailable.' };
        }
    }
    return { getMessage, searchParent };
}
