/**
 * Admin > Plugins > Development candidate.
 *
 * Owner-only admission for unpublished SDK candidates, visible only on the
 * dedicated loopback development instance. On any other host it explains the
 * required setup instead of offering an install path.
 *
 * After admission the existing canary/promote controls on this page qualify
 * the candidate; this component additionally exports the scoped developer
 * verification receipt bound to the canary evidence.
 */
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useToast } from '#imports';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';

interface Eligibility {
    readonly eligible: boolean;
    readonly reasons: readonly string[];
    readonly help: readonly string[];
}

interface CandidatePreview {
    readonly pluginId: string;
    readonly version: string;
    readonly profile: string;
    readonly packageTreeSha256: string;
    readonly authoritySha256: string;
    readonly requiredHostFeatures: readonly string[];
    readonly dirty: boolean;
    readonly revision: string;
}

const toast = useToast();
const eligibility = ref<Eligibility | null>(null);
const eligibilityError = ref<string | null>(null);
const packageFile = ref<File | null>(null);
const sourceFile = ref<File | null>(null);
const receiptFile = ref<File | null>(null);
const preview = ref<CandidatePreview | null>(null);
const previewError = ref<string | null>(null);
const admitting = ref(false);
const admitted = ref<{
    readonly pluginId: string;
    readonly version: string;
    readonly packageDigest: string;
} | null>(null);
const admitNote = ref<string | null>(null);
const verificationScope = ref<'runtime-canary' | 'recorded-interaction-check'>('runtime-canary');
const attestedInteraction = ref(false);
const exporting = ref(false);

const canAdmit = computed(
    () => eligibility.value?.eligible === true && packageFile.value && sourceFile.value && receiptFile.value && preview.value && !admitting.value
);

async function apiGet<T>(url: string): Promise<T> {
    return (await ($fetch as unknown as (input: string, init: Record<string, unknown>) => Promise<unknown>)(url, {
        credentials: 'include',
    })) as T;
}

onMounted(async () => {
    try {
        eligibility.value = await apiGet<Eligibility>('/api/admin/plugins/development/eligibility');
    } catch (error) {
        eligibilityError.value = error instanceof Error ? error.message : 'Eligibility could not be checked.';
    }
});

function pick(target: 'package' | 'source' | 'receipt', files: FileList | null): void {
    const file = files?.[0] ?? null;
    if (target === 'package') packageFile.value = file;
    else if (target === 'source') sourceFile.value = file;
    else receiptFile.value = file;
    preview.value = null;
    previewError.value = null;
    admitted.value = null;
    admitNote.value = null;
    if (target === 'receipt' && file) void previewReceipt(file);
}

/** Client-side identity preview from the receipt bytes (digests re-checked server-side). */
async function previewReceipt(file: File): Promise<void> {
    try {
        const raw = JSON.parse(await file.text()) as Record<string, unknown>;
        const source = raw.source as { revision?: unknown; dirty?: unknown };
        if (typeof raw.pluginId !== 'string' || typeof raw.version !== 'string') {
            throw new Error('This receipt does not describe a plugin candidate.');
        }
        preview.value = {
            pluginId: raw.pluginId,
            version: raw.version,
            profile: typeof raw.profile === 'string' ? raw.profile : 'unknown',
            packageTreeSha256: typeof raw.packageTreeSha256 === 'string' ? raw.packageTreeSha256 : 'unknown',
            authoritySha256: typeof raw.authoritySha256 === 'string' ? raw.authoritySha256 : 'unknown',
            requiredHostFeatures: Array.isArray(raw.requiredHostFeatures)
                ? raw.requiredHostFeatures.filter((entry): entry is string => typeof entry === 'string')
                : [],
            dirty: source?.dirty === true,
            revision: typeof source?.revision === 'string' ? source.revision : 'unknown',
        };
    } catch (error) {
        previewError.value = error instanceof Error ? error.message : 'The receipt could not be read.';
    }
}

async function admit(): Promise<void> {
    if (!packageFile.value || !sourceFile.value || !receiptFile.value) return;
    admitting.value = true;
    admitNote.value = null;
    try {
        const form = new FormData();
        form.append('package', packageFile.value);
        form.append('source', sourceFile.value);
        form.append('receipt', receiptFile.value);
        const result = (await ($fetch as unknown as (input: string, init: Record<string, unknown>) => Promise<unknown>)(
            '/api/admin/plugins/development/admit',
            { method: 'POST', credentials: 'include', headers: { ...ADMIN_HEADERS }, body: form }
        )) as {
            ok: boolean;
            pluginId: string;
            version: string;
            packageDigest: string;
            provenance: string;
            stage?: string;
            codes?: readonly string[];
        };
        if (!result.ok) {
            admitNote.value = `The candidate was blocked at ${result.stage ?? 'review'}: ${(result.codes ?? []).join(', ') || 'see the package checklist'}. Grants or setup may need attention before the canary.`;
            toast.add({ title: 'Candidate needs attention', description: admitNote.value, color: 'warning' });
            return;
        }
        admitted.value = { pluginId: result.pluginId, version: result.version, packageDigest: result.packageDigest };
        toast.add({
            title: 'Development candidate admitted',
            description: `${result.pluginId} ${result.version} is staged as a local candidate. Run its canary, then promote it below.`,
            color: 'success',
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'The candidate was refused.';
        admitNote.value = message;
        toast.add({ title: 'Admission refused', description: message, color: 'error' });
    } finally {
        admitting.value = false;
    }
}

async function exportVerification(): Promise<void> {
    if (!admitted.value) return;
    if (verificationScope.value === 'recorded-interaction-check' && !attestedInteraction.value) {
        toast.add({ title: 'Attestation required', description: 'Confirm you exercised the candidate in this browser first.', color: 'warning' });
        return;
    }
    exporting.value = true;
    try {
        const result = (await ($fetch as unknown as (input: string, init: Record<string, unknown>) => Promise<unknown>)(
            '/api/admin/plugins/development/verification',
            {
                method: 'POST',
                credentials: 'include',
                headers: { ...ADMIN_HEADERS, 'content-type': 'application/json' },
                body: {
                    pluginId: admitted.value.pluginId,
                    packageDigest: admitted.value.packageDigest,
                    scope: verificationScope.value,
                    ...(verificationScope.value === 'recorded-interaction-check' ? { attestedInteraction: true } : {}),
                },
            }
        )) as { receipt: Record<string, unknown> };
        const blob = new Blob([`${JSON.stringify(result.receipt, null, 2)}\n`], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${admitted.value.pluginId}-verification-${verificationScope.value}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        toast.add({ title: 'Verification receipt exported', description: 'Developer-supplied evidence, bound to the candidate and host.', color: 'success' });
    } catch (error) {
        toast.add({ title: 'Verification unavailable', description: error instanceof Error ? error.message : 'Run the candidate canary to a pass first.', color: 'error' });
    } finally {
        exporting.value = false;
    }
}
</script>

<template>
    <div class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
        <h3 class="text-base font-medium">Development candidate</h3>
        <p class="text-sm opacity-70">
            Test an unpublished SDK candidate as a real plugin. This dedicated
            development instance only; production and ordinary instances never
            offer this path.
        </p>

        <p v-if="eligibilityError" class="mt-2 text-sm text-[var(--md-sys-color-error,#b91c1c)]">
            {{ eligibilityError }}
        </p>

        <div v-else-if="eligibility && !eligibility.eligible" class="mt-2 text-sm">
            <p class="font-medium">Local testing is not available on this host.</p>
            <ul class="mt-1 list-disc pl-5 opacity-80">
                <li v-for="reason in eligibility.help" :key="reason">{{ reason }}</li>
            </ul>
            <p class="mt-1 opacity-70">
                Start the dedicated instance with <code>bun run dev:plugin</code>; it uses
                separate application data and extension storage.
            </p>
        </div>

        <div v-else-if="eligibility?.eligible" class="mt-3 flex flex-col gap-3">
            <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <label class="flex flex-col gap-1 text-xs">
                    package.zip
                    <input type="file" accept=".zip" data-testid="dev-candidate-package" @change="pick('package', ($event.target as HTMLInputElement).files)" />
                </label>
                <label class="flex flex-col gap-1 text-xs">
                    source.zip
                    <input type="file" accept=".zip" data-testid="dev-candidate-source" @change="pick('source', ($event.target as HTMLInputElement).files)" />
                </label>
                <label class="flex flex-col gap-1 text-xs">
                    receipt.json
                    <input type="file" accept=".json" data-testid="dev-candidate-receipt" @change="pick('receipt', ($event.target as HTMLInputElement).files)" />
                </label>
            </div>

            <p v-if="previewError" class="text-xs text-[var(--md-sys-color-error,#b91c1c)]">{{ previewError }}</p>

            <details v-if="preview" class="rounded border border-[var(--md-outline-variant)] p-2 text-xs">
                <summary class="cursor-pointer font-medium">
                    {{ preview.pluginId }} {{ preview.version }}
                    <span class="font-normal opacity-70">— Development candidate, not a marketplace release</span>
                </summary>
                <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    <dt>Profile</dt>
                    <dd class="break-all">{{ preview.profile }}</dd>
                    <dt>Package digest</dt>
                    <dd class="break-all font-mono">{{ preview.packageTreeSha256 }}</dd>
                    <dt>Authority</dt>
                    <dd class="break-all font-mono">{{ preview.authoritySha256 }}</dd>
                    <dt>Source</dt>
                    <dd class="break-all">{{ preview.revision }}{{ preview.dirty ? ' (dirty snapshot)' : ' (clean)' }}</dd>
                    <dt>Host features</dt>
                    <dd>{{ preview.requiredHostFeatures.join(', ') || 'none' }}</dd>
                </dl>
                <p class="mt-1 opacity-70">Digests are re-verified server-side on admission. Requested authority still needs explicit workspace approval, and the canary still runs before promotion.</p>
            </details>

            <div class="flex flex-wrap gap-2">
                <UButton
                    size="sm"
                    :disabled="!canAdmit"
                    :loading="admitting"
                    data-testid="dev-candidate-admit"
                    @click="admit"
                >
                    Admit candidate
                </UButton>
            </div>

            <p v-if="admitNote" class="text-xs opacity-80">{{ admitNote }}</p>

            <div v-if="admitted" class="flex flex-col gap-2 rounded border border-[var(--md-outline-variant)] p-2 text-xs" data-testid="dev-candidate-admitted">
                <p>
                    <strong>{{ admitted.pluginId }} {{ admitted.version }}</strong> staged.
                    Digest <code class="break-all">{{ admitted.packageDigest }}</code>.
                    Use Run canary and Promote in the package list below; open the plugin
                    from Chat to exercise it as a real sidebar, pane, tool and storage integration.
                </p>
                <div class="flex flex-col gap-2">
                    <label class="flex items-center gap-2">
                        Verification scope
                        <select v-model="verificationScope" class="rounded border border-[var(--md-outline-variant)] bg-transparent px-2 py-1">
                            <option value="runtime-canary">Runtime canary</option>
                            <option value="recorded-interaction-check">Recorded interaction check</option>
                        </select>
                    </label>
                    <label v-if="verificationScope === 'recorded-interaction-check'" class="flex items-center gap-2">
                        <input v-model="attestedInteraction" type="checkbox" />
                        I exercised this candidate's sidebar, pane, tools and storage in this browser.
                    </label>
                    <div>
                        <UButton size="xs" :loading="exporting" data-testid="dev-candidate-verify" @click="exportVerification">
                            Export verification receipt
                        </UButton>
                    </div>
                    <p class="opacity-70">Receipts are developer-supplied and never substitute for trusted marketplace validation. Replacing the candidate keeps plugin data and requires fresh authority review where grants changed.</p>
                </div>
            </div>
        </div>
        <p v-else class="mt-2 text-sm opacity-70">Checking this instance…</p>
    </div>
</template>
