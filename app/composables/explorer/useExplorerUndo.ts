import { useToast } from '@nuxt/ui/composables/useToast';
import { undoExplorerChange, type ExplorerUndoReceipt } from '~/db/explorer';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { explorerScopeKey, type ExplorerScope } from '~~/shared/explorer/records';
import { onScopeDispose } from 'vue';

type Entry = { receipt: ExplorerUndoReceipt; generation: number };
const receipts = new WeakMap<WorkspaceOperationScope['db'], Map<string, Entry>>();

export function useExplorerUndo(
    scope: ExplorerScope,
    getOrigin: () => WorkspaceOperationScope,
    busy: () => boolean,
    run: (action: (origin: WorkspaceOperationScope) => Promise<void>) => Promise<void>,
) {
    const toast = useToast();
    const key = explorerScopeKey(scope);
    let savedHere: { workspace: Map<string, Entry>; entry: Entry } | undefined;
    function clear() {
        if (savedHere && savedHere.workspace.get(key) === savedHere.entry) savedHere.workspace.delete(key);
        savedHere = undefined;
    }
    async function undo(expected?: ExplorerUndoReceipt) {
        if (busy()) return;
        const origin = getOrigin();
        const workspace = receipts.get(origin.db);
        const entry = workspace?.get(key);
        if (!entry || entry.generation !== origin.generation || (expected && expected !== entry.receipt)) return;
        workspace?.delete(key);
        await run(async current => {
            if (current.db !== origin.db) throw new Error('The workspace changed before the location could be restored.');
            await undoExplorerChange(current, scope, entry.receipt);
            toast.add({ title: 'Previous locations restored' });
        });
    }
    function save(origin: WorkspaceOperationScope, receipt: ExplorerUndoReceipt | undefined, title: string) {
        if (!receipt) return;
        let workspace = receipts.get(origin.db);
        if (!workspace) {
            workspace = new Map();
            receipts.set(origin.db, workspace);
        }
        const entry = { receipt, generation: origin.generation };
        workspace.set(key, entry);
        savedHere = { workspace, entry };
        toast.add({ title, actions: [{ label: 'Undo', onClick: () => { void undo(receipt); } }] });
    }
    function onKey(event: KeyboardEvent) {
        if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.shiftKey
            || event.altKey || event.key.toLowerCase() !== 'z' || !(event.target instanceof HTMLElement)
            || event.target.closest('input:not([type="checkbox"]),textarea,[contenteditable="true"]') || busy()) return;
        const origin = getOrigin();
        if (receipts.get(origin.db)?.get(key)?.generation !== origin.generation) return;
        event.preventDefault();
        event.stopPropagation();
        void undo();
    }
    onScopeDispose(clear);
    return { save, onKey, clear };
}
