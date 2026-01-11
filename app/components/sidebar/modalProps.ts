import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

type BaseModalProps = {
    class?: string;
    ui?: Record<string, unknown>;
    content?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createSidebarModalProps(
    identifier: string,
    base: BaseModalProps = {}
): ComputedRef<Record<string, unknown>> {
    const overrides = useThemeOverrides({
        component: 'modal',
        context: 'sidebar',
        identifier,
        isNuxtUI: true,
    });

    return computed(() => {
        const overrideValue = isRecord(overrides.value) ? overrides.value : {};

        const overrideClass =
            typeof overrideValue.class === 'string'
                ? overrideValue.class
                : undefined;
        const overrideUi = isRecord(overrideValue.ui)
            ? overrideValue.ui
            : undefined;
        const overrideContent = isRecord(overrideValue.content)
            ? overrideValue.content
            : undefined;

        const rest = Object.fromEntries(
            Object.entries(overrideValue).filter(
                ([key]) => key !== 'class' && key !== 'ui' && key !== 'content'
            )
        );

        const baseContent = isRecord(base.content) ? base.content : undefined;
        const mergedContent: Record<string, unknown> = {
            'aria-describedby': undefined,
            ...(baseContent ?? {}),
            ...(overrideContent ?? {}),
        };

        const mergedUiSource: Record<string, unknown> = {
            ...(base.ui ?? {}),
            ...(overrideUi ?? {}),
        };

        const result: Record<string, unknown> = {
            ...rest,
        };

        result.content = mergedContent;

        if (Object.keys(mergedUiSource).length > 0) {
            result.ui = mergedUiSource;
        }

        const mergedClass = [base.class, overrideClass]
            .filter(
                (value): value is string =>
                    typeof value === 'string' && value.trim().length > 0
            )
            .join(' ');

        if (mergedClass.length > 0) {
            result.class = mergedClass;
        }

        return result;
    });
}
