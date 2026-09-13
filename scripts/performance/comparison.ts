import type { PerformanceBudget } from './report';

export function assertNoMaterialMaxRegression(
    candidate: Record<string, PerformanceBudget>,
    base: Record<string, PerformanceBudget>,
    tolerance = 0.10
): string[] {
    const accepted: string[] = [];
    for (const [name, budget] of Object.entries(candidate)) {
        if (budget.passed) continue;
        const baseBudget = base[name];
        if (!baseBudget || baseBudget.direction !== 'max' || baseBudget.passed) {
            throw new Error(`${name} failed its absolute budget without a same-host base failure.`);
        }
        const allowed = baseBudget.actual * (1 + tolerance);
        if (budget.actual > allowed) {
            throw new Error(`${name} regressed from ${baseBudget.actual} to ${budget.actual}; same-host allowance is ${allowed.toFixed(2)}.`);
        }
        accepted.push(`${name}: candidate=${budget.actual}, base=${baseBudget.actual}, allowance=${allowed.toFixed(2)}`);
    }
    if (accepted.length === 0) {
        throw new Error('Comparative performance fallback requires at least one failed absolute candidate budget.');
    }
    return accepted;
}
