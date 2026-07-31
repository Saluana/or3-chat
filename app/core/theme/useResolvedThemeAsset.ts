import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import { createThemeBackgroundTokenResolver } from './backgrounds';

const resolveToken = createThemeBackgroundTokenResolver();

/** Resolve theme asset tokens through the shared background cache. */
export function useResolvedThemeAsset(
    token: MaybeRefOrGetter<string | null | undefined>
): Ref<string | null> {
    const resolved = ref<string | null>(null);
    let revision = 0;
    watch(
        () => toValue(token),
        async (value) => {
            const currentRevision = ++revision;
            const next = value ? await resolveToken(value) : null;
            if (currentRevision === revision) resolved.value = next;
        },
        { immediate: true }
    );
    return resolved;
}
