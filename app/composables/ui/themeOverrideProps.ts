type AnyRecord = Record<string, unknown>;

export function buildThemeOverrideProps(
    overrideValue: unknown,
    options?: {
        baseClass?: string;
        baseUi?: AnyRecord;
        baseContent?: AnyRecord;
    }
): AnyRecord {
    const override = (overrideValue as AnyRecord | null) || {};
    const overrideClass =
        typeof override.class === 'string' ? (override.class as string) : '';
    const overrideUi = (override.ui as AnyRecord | undefined) || {};
    const overrideContent = (override.content as AnyRecord | undefined) || {};

    const rest = Object.fromEntries(
        Object.entries(override).filter(
            ([key]) => key !== 'class' && key !== 'ui' && key !== 'content'
        )
    ) as AnyRecord;

    const result: AnyRecord = {
        ...rest,
    };

    if (options?.baseUi || Object.keys(overrideUi).length > 0) {
        result.ui = {
            ...(options?.baseUi || {}),
            ...overrideUi,
        };
    }

    if (options?.baseContent || Object.keys(overrideContent).length > 0) {
        result.content = {
            ...(options?.baseContent || {}),
            ...overrideContent,
        };
    }

    const mergedClass = [options?.baseClass || '', overrideClass]
        .filter(Boolean)
        .join(' ')
        .trim();

    if (mergedClass) {
        result.class = mergedClass;
    }

    return result;
}
