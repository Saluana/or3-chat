import type { WorkspaceSettingsStore, WorkspaceSummary } from '../stores/types';
import { createHash } from 'node:crypto';
import { getEnabledPlugins, getPluginGrantReview, setPluginEnabled, setPluginGrantReview, type PluginGrantCandidate } from './workspace-plugin-store';
import { SitePluginPolicyStore, type SiteFutureDefault } from './site-policy';
import { PluginRolloutStore, type PluginRolloutRecord, type PluginRolloutTarget } from './rollout-store';

export type RolloutSelection =
    | { readonly kind: 'selected'; readonly workspaceIds: readonly string[] }
    | { readonly kind: 'all-existing' }
    | { readonly kind: 'new-only' };

export interface PluginRolloutDependencies {
    readonly policies: SitePluginPolicyStore;
    readonly records: PluginRolloutStore;
    readonly settings: WorkspaceSettingsStore;
    readonly listAllWorkspaceIds: () => Promise<readonly string[]>;
    readonly getWorkspace: (workspaceId: string) => Promise<WorkspaceSummary | null>;
    readonly selectedPointer: (pluginId: string, requireReady?: boolean) => Promise<{ packageDigest: string; revision: number } | null>;
    readonly withPluginLock: <T>(pluginId: string, fn: () => Promise<T>) => Promise<T>;
    readonly checkSetup: (workspaceId: string, pluginId: string, packageDigest: string) => Promise<'ready' | 'required' | 'blocked'>;
    readonly onApplied?: (workspaceId: string, pluginId: string, enabled: boolean) => Promise<void>;
}

function failure(code: string, message: string) {
    return Object.assign(new Error(message), { code });
}

function reviewFingerprint(raw: string | null): `sha256-${string}` | null {
    return raw === null ? null : `sha256-${createHash('sha256').update(raw).digest('hex')}`;
}

function rolloutReviewOwner(record: PluginRolloutRecord): string {
    return `${record.actorId} via ${record.id}`;
}

function isRolloutOwnedReview(raw: string | null, record: PluginRolloutRecord, candidate: PluginGrantCandidate): boolean {
    if (!raw) return false;
    try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object') return false;
        const review = value as Record<string, unknown>;
        const grants: unknown[] = Array.isArray(review.approvedGrants) ? review.approvedGrants : [];
        return review.schemaVersion === 2 && review.reviewedBy === rolloutReviewOwner(record) &&
            review.reviewedAt === record.createdAt && review.packageDigest === record.packageDigest &&
            review.authoritySha256 === record.authoritySha256 && review.releaseId === candidate.releaseId &&
            JSON.stringify([...grants].sort()) === JSON.stringify([...record.approvedGrants].sort());
    } catch { return false; }
}

function futureFingerprint(value: SiteFutureDefault | null): `sha256-${string}` {
    return `sha256-${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function assertRevision(record: PluginRolloutRecord, expectedRevision?: number): void {
    if (expectedRevision !== undefined && record.revision !== expectedRevision) {
        throw failure('rollout-conflict', 'This rollout changed in another session. Refresh its progress before continuing.');
    }
}

async function bounded<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<T>((_, reject) => { timer = setTimeout(() => reject(failure('provider-timeout', 'The provider did not respond; retry to reconcile this workspace.')), 8_000); }),
        ]);
    } finally { if (timer) clearTimeout(timer); }
}

/** Durable, request-driven workspace changes; each continuation is a bounded batch. */
export class PluginRolloutCoordinator {
    constructor(readonly deps: PluginRolloutDependencies) {}

    async createPreview(input: {
        readonly pluginId: string;
        readonly actorId: string;
        readonly selection: RolloutSelection;
        readonly enabled: boolean;
        readonly includeFutureWorkspaces: boolean;
        readonly approvedGrants: readonly string[];
        readonly candidate: PluginGrantCandidate;
        readonly provisioningGuard?: { readonly policyRevision: number; readonly futureDefault: SiteFutureDefault };
    }): Promise<PluginRolloutRecord> {
        if (!this.deps.settings.compareAndSet) throw failure('bulk-settings-cas-unavailable', 'This provider cannot safely apply a bulk plugin rollout.');
        const policyRequired = input.enabled || input.includeFutureWorkspaces || Boolean(input.provisioningGuard);
        const policy = policyRequired ? await this.deps.policies.read(input.pluginId) : null;
        const pointer = await this.deps.selectedPointer(input.pluginId, input.enabled);
        if (input.provisioningGuard && (policy?.revision !== input.provisioningGuard.policyRevision ||
            futureFingerprint(policy.futureDefault) !== futureFingerprint(input.provisioningGuard.futureDefault))) {
            throw failure('rollout-preview-stale', 'The future workspace default changed while this workspace was being created.');
        }
        if ((policyRequired && !policy) || (input.enabled && !policy?.catalogVisible) || !pointer || !input.candidate.packageDigest || !input.candidate.authoritySha256 ||
            (input.enabled && policy?.approvedRelease.packageTreeSha256 !== input.candidate.packageDigest) ||
            (input.enabled && policy?.approvedRelease.authoritySha256 !== input.candidate.authoritySha256) ||
            pointer.packageDigest !== input.candidate.packageDigest) {
            throw failure('rollout-preview-stale', 'The selected release or site approval changed. Review it again.');
        }
        if (!input.approvedGrants.every((grant) => input.candidate.requestedGrants.includes(grant))) {
            throw failure('invalid-grants', 'The approval contains access the release did not request.');
        }
        if (input.selection.kind === 'new-only' && !input.includeFutureWorkspaces) {
            throw failure('rollout-invalid', 'New-workspace-only rollout must include the future default.');
        }
        const ids = input.selection.kind === 'all-existing' ? await this.deps.listAllWorkspaceIds()
            : input.selection.kind === 'selected' ? input.selection.workspaceIds : [];
        const unique = [...new Set(ids)];
        if (unique.length > 10_000 || (input.selection.kind === 'selected' && unique.length > 1_000)) {
            throw failure('rollout-invalid', 'Too many workspaces were selected. Narrow the selection.');
        }
        const targets: PluginRolloutTarget[] = [];
        for (let offset = 0; offset < unique.length; offset += 25) {
            const chunk = await Promise.all(unique.slice(offset, offset + 25).map(async (workspaceId) => {
                const workspace = await bounded(this.deps.getWorkspace(workspaceId));
                if (!workspace || workspace.deleted) return null;
                const enabled = await bounded(getEnabledPlugins(this.deps.settings, workspaceId));
                if (!input.enabled) return { workspaceId, enabledBefore: enabled.includes(input.pluginId), previewBlock: null, needsPermissionReview: false, outcome: { state: 'pending' as const } };
                const [setup, review, rawReview] = await Promise.all([
                    bounded(this.deps.checkSetup(workspaceId, input.pluginId, input.candidate.packageDigest!)).catch(() => 'blocked' as const),
                    bounded(getPluginGrantReview(this.deps.settings, workspaceId, input.pluginId, input.candidate)).catch(() => null),
                    bounded(this.deps.settings.get(workspaceId, `plugins.grants.${input.pluginId}`)),
                ]);
                return {
                    workspaceId, enabledBefore: enabled.includes(input.pluginId),
                    previewBlock: setup === 'ready' ? null : setup === 'required' ? 'Needs workspace setup' : 'Setup check unavailable',
                    needsPermissionReview: review?.status !== 'current',
                    grantReviewBeforeSha256: reviewFingerprint(rawReview),
                    outcome: { state: 'pending' as const },
                };
            }));
            for (const target of chunk) if (target) targets.push(target);
        }
        return this.deps.records.create({
            pluginId: input.pluginId, actorId: input.actorId,
            packageDigest: input.candidate.packageDigest,
            authoritySha256: input.candidate.authoritySha256,
            pointerRevision: pointer.revision, policyRevision: policy?.revision ?? 0,
            enabled: input.enabled, includeFutureWorkspaces: input.includeFutureWorkspaces,
            approvedGrants: [...new Set(input.approvedGrants)],
            ...(input.provisioningGuard ? { provisioningGuard: {
                policyRevision: input.provisioningGuard.policyRevision,
                futureDefaultSha256: futureFingerprint(input.provisioningGuard.futureDefault),
            } } : {}),
            selection: input.selection.kind, targets,
        });
    }

    async start(id: string, candidate: PluginGrantCandidate, expectedRevision?: number): Promise<PluginRolloutRecord> {
        const initial = await this.requireRecord(id);
        return this.deps.withPluginLock(initial.pluginId, async () => {
            let record = await this.requireRecord(id);
            assertRevision(record, expectedRevision);
            if (record.status !== 'preview') return record;
            // If a process stopped after saving the future default but before
            // the journal update, adopt that exact write instead of repeating it.
            const priorPolicy = record.includeFutureWorkspaces ? await this.deps.policies.read(record.pluginId) : null;
            const expectedFuture: SiteFutureDefault | null = record.enabled
                ? { enabled: true, packageTreeSha256: record.packageDigest, authoritySha256: record.authoritySha256, approvedGrants: record.approvedGrants }
                : null;
            const priorWriteCompleted = record.includeFutureWorkspaces && priorPolicy?.revision === record.policyRevision + 1 &&
                priorPolicy.updatedBy === record.actorId && priorPolicy.updatedAt >= record.createdAt &&
                JSON.stringify(priorPolicy.futureDefault) === JSON.stringify(expectedFuture);
            if (priorWriteCompleted) {
                record = { ...record, policyRevision: priorPolicy!.revision, futureDefaultApplied: true, futurePolicyRevision: priorPolicy!.revision };
            }
            if (record.expiresAt < Date.now()) {
                if (priorWriteCompleted) await this.deps.records.replace({ ...record, revision: record.revision + 1 });
                throw failure('rollout-preview-stale', 'The rollout preview expired. Review current workspaces again.');
            }
            await this.assertCurrent(record, candidate, true);
            if (record.includeFutureWorkspaces) {
                if (!priorWriteCompleted) {
                    const policy = await this.deps.policies.read(record.pluginId);
                    if (!policy) throw failure('rollout-preview-stale', 'Site approval disappeared.');
                    const saved = await this.deps.policies.saveWithinOperation(record.pluginId, policy.revision, {
                        catalogVisible: policy.catalogVisible, approvedRelease: policy.approvedRelease, futureDefault: expectedFuture,
                    }, record.actorId);
                    record = { ...record, policyRevision: saved.revision, futureDefaultApplied: true, futurePolicyRevision: saved.revision };
                }
            }
            record = await this.deps.records.replace({ ...record, revision: record.revision + 1, status: record.targets.length ? 'running' : 'completed' });
            return record;
        });
    }

    async continue(id: string, candidate: PluginGrantCandidate, expectedRevision?: number): Promise<PluginRolloutRecord> {
        const initial = await this.requireRecord(id);
        return this.deps.withPluginLock(initial.pluginId, async () => {
            const record = await this.requireRecord(id);
            assertRevision(record, expectedRevision);
            if (record.status !== 'running') return record;
            await this.assertCurrent(record, candidate, false);
            const targets = [...record.targets];
            const startedAt = Date.now();
            let visited = 0;
            for (let index = 0; index < targets.length && visited < 25; index += 1) {
                if (targets[index]!.outcome.state !== 'pending') continue;
                if (visited > 0 && Date.now() - startedAt >= 5_000) break;
                const target = targets[index]!;
                targets[index] = { ...target, outcome: await this.applyTarget(record, target, candidate) };
                visited += 1;
            }
            const status = targets.some((target) => target.outcome.state === 'pending') ? 'running' : 'completed';
            return this.deps.records.replace({ ...record, targets, status, revision: record.revision + 1 });
        });
    }

    async retry(id: string, candidate: PluginGrantCandidate, expectedRevision?: number): Promise<PluginRolloutRecord> {
        const initial = await this.requireRecord(id);
        return this.deps.withPluginLock(initial.pluginId, async () => {
            const record = await this.requireRecord(id);
            assertRevision(record, expectedRevision);
            if (record.status === 'preview') throw failure('rollout-invalid', 'Start the reviewed rollout first.');
            if (record.status === 'cancelled') throw failure('rollout-invalid', 'This rollout was cancelled. Create a new preview to continue changing workspaces.');
            await this.assertCurrent(record, candidate, false);
            const targets = record.targets.map((target) =>
                target.outcome.state === 'blocked' || target.outcome.state === 'failed'
                    ? { ...target, outcome: { state: 'pending' as const } } : target);
            return this.deps.records.replace({ ...record, targets, status: targets.some((target) => target.outcome.state === 'pending') ? 'running' : 'completed', revision: record.revision + 1 });
        });
    }

    async cancel(id: string, expectedRevision?: number): Promise<PluginRolloutRecord> {
        const initial = await this.requireRecord(id);
        return this.deps.withPluginLock(initial.pluginId, async () => {
            let record = await this.requireRecord(id);
            assertRevision(record, expectedRevision);
            if (record.status === 'cancelled' || record.status === 'completed') return record;
            if (record.status === 'preview' && record.includeFutureWorkspaces && !record.futureDefaultApplied) {
                const policy = await this.deps.policies.read(record.pluginId);
                const expectedFuture: SiteFutureDefault | null = record.enabled
                    ? { enabled: true, packageTreeSha256: record.packageDigest, authoritySha256: record.authoritySha256, approvedGrants: record.approvedGrants }
                    : null;
                if (policy?.revision === record.policyRevision + 1 && policy.updatedBy === record.actorId &&
                    policy.updatedAt >= record.createdAt && JSON.stringify(policy.futureDefault) === JSON.stringify(expectedFuture)) {
                    record = { ...record, policyRevision: policy.revision, futureDefaultApplied: true, futurePolicyRevision: policy.revision };
                }
            }
            return this.deps.records.replace({ ...record, status: 'cancelled', revision: record.revision + 1 });
        });
    }

    async requireRecord(id: string): Promise<PluginRolloutRecord> {
        const record = await this.deps.records.read(id);
        if (!record) throw failure('rollout-not-found', 'Rollout operation not found.');
        return record;
    }

    async assertCurrent(record: PluginRolloutRecord, candidate: PluginGrantCandidate, preview: boolean): Promise<void> {
        const policyRequired = record.enabled || record.includeFutureWorkspaces || Boolean(record.provisioningGuard);
        const [pointer, policy] = await Promise.all([
            this.deps.selectedPointer(record.pluginId, record.enabled),
            policyRequired ? this.deps.policies.read(record.pluginId) : Promise.resolve(null),
        ]);
        if (!pointer || (policyRequired && !policy) || (record.enabled && !policy?.catalogVisible) || pointer.packageDigest !== record.packageDigest ||
            pointer.revision !== record.pointerRevision || (policyRequired && policy?.revision !== record.policyRevision) ||
            (record.enabled && policy?.approvedRelease.packageTreeSha256 !== record.packageDigest) ||
            candidate.packageDigest !== record.packageDigest || candidate.authoritySha256 !== record.authoritySha256) {
            throw failure(preview ? 'rollout-preview-stale' : 'rollout-conflict', 'The selected release or site approval changed. Review the impact again.');
        }
        if (record.provisioningGuard && (!policy || policy.revision !== record.provisioningGuard.policyRevision ||
            futureFingerprint(policy.futureDefault) !== record.provisioningGuard.futureDefaultSha256)) {
            throw failure(preview ? 'rollout-preview-stale' : 'rollout-conflict', 'The future workspace default changed. Repair this created workspace without making another.');
        }
    }

    async applyTarget(record: PluginRolloutRecord, target: PluginRolloutTarget, candidate: PluginGrantCandidate): Promise<PluginRolloutTarget['outcome']> {
        try {
            const workspace = await bounded(this.deps.getWorkspace(target.workspaceId));
            if (!workspace || workspace.deleted) return { state: 'skipped', reason: 'workspace-deleted' };
            const current = await bounded(getEnabledPlugins(this.deps.settings, target.workspaceId));
            const currentlyEnabled = current.includes(record.pluginId);
            if (currentlyEnabled === record.enabled && currentlyEnabled !== target.enabledBefore) {
                await this.notifyApplied(record, target);
                return { state: 'already-applied' };
            }
            if (currentlyEnabled !== target.enabledBefore) return { state: 'blocked', code: 'rollout-conflict', message: 'This workspace’s plugin choice changed after preview.' };
            if (record.enabled) {
                const rawReview = await bounded(this.deps.settings.get(target.workspaceId, `plugins.grants.${record.pluginId}`));
                const ownedReview = isRolloutOwnedReview(rawReview, record, candidate);
                if (target.grantReviewBeforeSha256 === undefined ||
                    (reviewFingerprint(rawReview) !== target.grantReviewBeforeSha256 && !ownedReview)) {
                    return { state: 'blocked', code: 'grant-review-changed', message: 'Workspace permissions changed after preview. Review this workspace again.' };
                }
                const review = await bounded(getPluginGrantReview(this.deps.settings, target.workspaceId, record.pluginId, candidate));
                if (review.status !== 'current' || !record.approvedGrants.every((grant) => review.approvedGrants.includes(grant))) {
                    if (ownedReview) return { state: 'blocked', code: 'grant-review-changed', message: 'The rollout permission review is no longer valid. Review this workspace again.' };
                    try {
                        await setPluginGrantReview(this.deps.settings, target.workspaceId, record.pluginId, {
                            candidate, approvedGrants: record.approvedGrants, reviewedBy: rolloutReviewOwner(record), reviewedAt: record.createdAt,
                            expectedCurrentRaw: rawReview, requireCas: true,
                            retainPackageDigests: candidate.packageDigest ? [candidate.packageDigest] : [],
                        });
                    } catch (error) {
                        if ((error as { code?: string }).code === 'grant-review-conflict') return { state: 'blocked', code: 'grant-review-changed', message: 'Workspace permissions changed while the rollout was applying. Review this workspace again.' };
                        return { state: 'failed', code: 'grant-write-failed', message: 'The permission review could not be saved for this workspace.' };
                    }
                }
                const setup = await bounded(this.deps.checkSetup(target.workspaceId, record.pluginId, record.packageDigest));
                if (setup !== 'ready') return { state: 'blocked', code: 'setup-required', message: setup === 'required' ? 'Complete this workspace’s plugin setup.' : 'This plugin’s setup is unavailable on this host.' };
            }
            // An unabortable provider mutation must retain the plugin lease until
            // it settles; a timer could otherwise report cancellation before a
            // delayed CAS commits.
            await setPluginEnabled(this.deps.settings, target.workspaceId, record.pluginId, record.enabled, {
                requireCas: true, expectedPluginState: target.enabledBefore,
            });
            await this.notifyApplied(record, target);
            return { state: 'applied' };
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'workspace-write-failed';
            return { state: 'failed', code, message: code === 'provider-timeout' ? 'Provider response timed out; retry to reconcile this workspace.' : 'This workspace could not be changed. Retry after checking its settings.' };
        }
    }

    private async notifyApplied(record: PluginRolloutRecord, target: PluginRolloutTarget): Promise<void> {
        try {
            await bounded(this.deps.onApplied?.(target.workspaceId, record.pluginId, record.enabled) ?? Promise.resolve());
        } catch (error) {
            // The provider write is committed. An optional observer failure
            // cannot turn the recorded result into a retryable workspace write.
            console.warn('[plugin-rollout] Post-commit observer failed', {
                pluginId: record.pluginId, workspaceId: target.workspaceId,
                code: (error as { code?: string }).code ?? 'observer-failed',
            });
        }
    }
}
