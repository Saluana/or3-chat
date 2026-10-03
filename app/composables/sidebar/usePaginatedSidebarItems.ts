import { ref, shallowRef, type Ref, onMounted, onUnmounted, watch } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import { readFamilyPage, readFamilyMembers, latestFamilyCompaction, threadToSidebar, documentToSidebar, familyExpansionPreferenceName, FAMILY_PAGE_SIZE, type FamilyFilter } from '~/utils/sidebar/thread-families';

export const threadToUnified = threadToSidebar;
export const docToUnified = documentToSidebar;
const preferenceName = familyExpansionPreferenceName;

/** One flat family model shared by both sidebar consumers. */
export function usePaginatedSidebarItems(options: { type?: 'all' | 'thread' | 'document'; query?: Ref<string>;
    projectId?: Ref<string | undefined>; pinned?: Ref<boolean | undefined> } = {}) {
    const items = shallowRef<UnifiedSidebarItem[]>([]); const hasMore = ref(true); const loading = ref(false);
    const targetCount = ref(FAMILY_PAGE_SIZE); const memberLimits = new Map<string, number>();
    let subscription: Subscription | undefined; let subscriptionToken = 0; let mounted = false;
    const filter = (): FamilyFilter => ({ query: options.query?.value.trim(), projectId: options.projectId?.value, pinned: options.pinned?.value });
    async function fetchItems() {
        const db = getDb(); const generation = getWorkspaceGeneration(); const currentFilter = filter();
        const page = await readFamilyPage(db, { limit: targetCount.value, type: options.type ?? 'all', filter: currentFilter });
        const rows: UnifiedSidebarItem[] = [];
        for (const item of page.items) {
            if (!item.family) { rows.push(item); continue; }
            const rootId = item.family.rootId;
            const saved = await getKvByName(preferenceName(rootId), db);
            const expanded = Boolean(currentFilter.query) || saved?.value === 'true';
            item.family.expanded = expanded; item.family.searchExpanded = Boolean(currentFilter.query); rows.push(item);
            if (!expanded) continue;
            const memberPage = await readFamilyMembers(db, rootId, memberLimits.get(rootId) ?? FAMILY_PAGE_SIZE, currentFilter);
            for (const member of memberPage.members) rows.push({ ...threadToSidebar(member),
                family: { kind: 'thread-member', key: 'member:' + rootId + ':' + member.id, rootId, expanded: true,
                    groupUpdatedAt: item.updatedAt,
                    label: member.id === rootId ? 'Original' : member.branch_mode === 'compacted' ? 'Compacted' : member.fork_reason === 'retry' ? 'Retry' : 'Branch',
                    damaged: item.family.damaged, originalId: item.family.originalId } });
            if (memberPage.hasMore) rows.push({ ...item, family: { ...item.family, kind: 'load-more-members', key: 'more-members:' + rootId } });
        }
        if (getDb() !== db || getWorkspaceGeneration() !== generation) throw new Error('Sidebar workspace changed.');
        return { rows, hasMore: page.hasMore };
    }
    function startSubscription() {
        if (!mounted) return;
        const token = ++subscriptionToken; const db = getDb(); const generation = getWorkspaceGeneration();
        loading.value = items.value.length === 0; subscription?.unsubscribe();
        subscription = liveQuery(fetchItems).subscribe({ next: (result) => {
            if (token !== subscriptionToken || getDb() !== db || generation !== getWorkspaceGeneration()) return;
            items.value = result.rows; hasMore.value = result.hasMore; loading.value = false;
        }, error: () => { if (token === subscriptionToken) loading.value = false; } });
    }
    function loadMore() { if (loading.value || !hasMore.value) return; targetCount.value += FAMILY_PAGE_SIZE; startSubscription(); }
    function reset() { targetCount.value = FAMILY_PAGE_SIZE; memberLimits.clear(); hasMore.value = true; startSubscription(); }
    async function toggleFamily(rootId: string) {
        const db = getDb(); const generation = getWorkspaceGeneration();
        const saved = await getKvByName(preferenceName(rootId), db);
        if (getDb() !== db || generation !== getWorkspaceGeneration()) return;
        await setKvByName(preferenceName(rootId), saved?.value === 'true' ? 'false' : 'true', db,
            { isValid: () => getDb() === db && generation === getWorkspaceGeneration() });
    }
    function loadMoreMembers(rootId: string) { memberLimits.set(rootId, (memberLimits.get(rootId) ?? FAMILY_PAGE_SIZE) + FAMILY_PAGE_SIZE); startSubscription(); }
    async function latestCompaction(rootId: string) {
        const db = getDb(); const generation = getWorkspaceGeneration(); const id = await latestFamilyCompaction(db, rootId, filter());
        return getDb() === db && generation === getWorkspaceGeneration() ? id : undefined;
    }
    const stopWorkspace = subscribeActiveWorkspaceDb(() => { items.value = []; reset(); });
    watch(() => [options.query?.value, options.projectId?.value, options.pinned?.value], reset);
    onMounted(() => { mounted = true; startSubscription(); });
    onUnmounted(() => { mounted = false; subscriptionToken++; subscription?.unsubscribe(); stopWorkspace(); });
    return { items, hasMore, loading, loadMore, reset, toggleFamily, loadMoreMembers, latestCompaction };
}
