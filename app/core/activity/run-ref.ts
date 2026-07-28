export const ACTIVITY_DETAIL_PANE_APP_ID = 'or3-activity-detail';
export const ACTIVITY_SIDEBAR_PAGE_ID = 'or3-activity';

export interface ActivityRunRef {
    readonly sourceId: string;
    readonly runId: string;
}

export function encodeActivityRunRef(ref: ActivityRunRef): string {
    return encodeURIComponent(JSON.stringify([ref.sourceId, ref.runId]));
}

export function decodeActivityRunRef(
    value: string | null | undefined
): ActivityRunRef | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
        if (
            !Array.isArray(parsed) ||
            parsed.length !== 2 ||
            typeof parsed[0] !== 'string' ||
            typeof parsed[1] !== 'string' ||
            !parsed[0] ||
            !parsed[1]
        ) {
            return null;
        }
        return { sourceId: parsed[0], runId: parsed[1] };
    } catch {
        return null;
    }
}

