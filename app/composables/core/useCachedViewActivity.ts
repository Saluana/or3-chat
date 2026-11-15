import { computed, inject, onActivated, onBeforeUnmount, onDeactivated, provide, ref, type InjectionKey, type Ref } from 'vue';

const cachedViewActivity: InjectionKey<Readonly<Ref<boolean>>> = Symbol('cached-view-activity');

/** Presentation work follows the whole cached subtree, including children mounted while hidden. */
export function useCachedViewActivity(): Readonly<Ref<boolean>> {
    const parent = inject(cachedViewActivity, undefined);
    const active = ref(true);
    onActivated(() => { active.value = true; });
    onDeactivated(() => { active.value = false; });
    onBeforeUnmount(() => { active.value = false; });
    const visible = computed(() => active.value && parent?.value !== false);
    provide(cachedViewActivity, visible);
    return visible;
}
