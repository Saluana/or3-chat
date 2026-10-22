import { readRequestUsage, type UsageTotals } from '~~/shared/chat/compaction';

export interface UsageRow {
    label: string;
    value: string;
    /** Totals the reader is after. */
    strong?: true;
    /** Not measured: shown so a missing figure is explained rather than silently absent. */
    muted?: true;
}

export interface UsageLabel {
    /** Short inline text, for example `1.6k tok · $0.0042`. */
    text: string;
    /** Label/value rows for the tooltip. */
    rows: UsageRow[];
    model?: string;
    /** Plain-language version of the rows for assistive technology. */
    description: string;
}

/** `950`, `1.6k`, `12k`, `1.2M`. */
export function formatTokenCount(count: number): string {
    const trim = (value: number) => value.toFixed(1).replace(/\.0$/, '');
    if (count >= 1_000_000) return `${trim(count / 1_000_000)}M`;
    if (count >= 10_000) return `${Math.round(count / 1000)}k`;
    if (count >= 1000) return `${trim(count / 1000)}k`;
    return String(count);
}

/** OpenRouter credits are USD; tiny charges keep enough digits to stay meaningful. */
export function formatCredits(cost: number): string {
    if (cost <= 0) return '$0';
    if (cost < 0.0001) return '<$0.0001';
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
}

/**
 * Subtle per-reply usage from the stored `data.usage`. Rows saved before totals
 * existed hold one request's counters, which are the whole reply only when it
 * made a single request.
 */
export function buildUsageLabel(raw: unknown): UsageLabel | undefined {
    const usage = readRequestUsage(raw);
    if (!usage) return undefined;
    const totals: UsageTotals | undefined = usage.totals
        ?? (usage.iteration === 1
            ? { requests: 1, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens,
                cost: usage.cost, cached_tokens: usage.cached_tokens, reasoning_tokens: usage.reasoning_tokens }
            : undefined);
    if (!totals) return undefined;
    const tokens = totals.prompt_tokens + totals.completion_tokens;
    if (tokens <= 0) return undefined;

    // A free request reports a zero charge, which is not worth a label of its own.
    const showCost = totals.cost !== undefined && totals.cost > 0;
    const text = `${formatTokenCount(tokens)} tok${showCost ? ` · ${formatCredits(totals.cost!)}` : ''}`;

    const count = (value: number) => value.toLocaleString('en-US');
    const rows: UsageRow[] = [
        { label: 'Prompt', value: count(totals.prompt_tokens) },
        { label: 'Completion', value: count(totals.completion_tokens) },
    ];
    if (totals.reasoning_tokens !== undefined) rows.push({ label: 'Reasoning', value: count(totals.reasoning_tokens) });
    if (totals.cached_tokens !== undefined) rows.push({ label: 'Cached', value: count(totals.cached_tokens) });
    rows.push({ label: 'Total', value: count(tokens), strong: true });
    if (totals.requests > 1) rows.push({ label: 'Requests', value: count(totals.requests) });
    // Sub-cent charges keep six digits here; the inline label stays short.
    rows.push(totals.cost === undefined
        ? { label: 'Cost', value: 'Not recorded', muted: true }
        : { label: 'Cost', strong: true,
            value: totals.cost > 0 && totals.cost < 0.01 ? `$${totals.cost.toFixed(6)}` : formatCredits(totals.cost) });
    const description = `${rows.map(({ label, value }) => `${label} ${value}`).join(', ')}${usage.model ? `, ${usage.model}` : ''}`;
    return { text, rows, ...(usage.model ? { model: usage.model } : {}), description };
}
