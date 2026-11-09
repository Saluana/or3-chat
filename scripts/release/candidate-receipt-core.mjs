export function assertCandidateReceipt(value) {
    const receipt = value;
    // Schema 1 can authorize only the single application image. Reject extra
    // fields so a future or mixed-profile receipt cannot be silently reduced
    // to this older contract by the current promotion workflow.
    const schema1Keys = new Set([
        'schemaVersion', 'kind', 'version', 'sourceSha', 'candidateImage', 'candidateDigest',
        'operatorCandidateImage', 'operatorCandidateDigest', 'tarballFile', 'tarballSha256',
        'tarballIntegrity', 'workflowRunId', 'qualifiedAt',
    ]);
    const expectedCandidate = receipt?.version && receipt?.sourceSha
        ? `ghcr.io/saluana/or3-chat:candidate-${receipt.version}-${receipt.sourceSha}`
        : '';
    const expectedOperatorCandidate = receipt?.version && receipt?.sourceSha
        ? `ghcr.io/saluana/or3-chat:candidate-operator-${receipt.version}-${receipt.sourceSha}`
        : '';
    if (
        !receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
        Object.keys(receipt).some((key) => !schema1Keys.has(key)) ||
        receipt.schemaVersion !== 1 ||
        receipt.kind !== 'or3-cloud-qualified-candidate' ||
        !/^\d+\.\d+\.\d+$/.test(receipt.version ?? '') ||
        !/^[0-9a-f]{40}$/.test(receipt.sourceSha ?? '') ||
        !/^sha256:[0-9a-f]{64}$/.test(receipt.candidateDigest ?? '') ||
        !/^sha256:[0-9a-f]{64}$/.test(receipt.operatorCandidateDigest ?? '') ||
        !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(receipt.tarballIntegrity ?? '') ||
        !/^[0-9a-f]{64}$/.test(receipt.tarballSha256 ?? '') ||
        receipt.candidateImage !== expectedCandidate ||
        receipt.operatorCandidateImage !== expectedOperatorCandidate ||
        receipt.tarballFile !== `or3-cloud-${receipt.version}.tgz` ||
        !/^\d+$/.test(receipt.workflowRunId ?? '') ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(receipt.qualifiedAt ?? '')
    ) {
        throw new Error('Candidate receipt is missing required immutable release evidence.');
    }
    return receipt;
}

// Schema 2 is deliberately a separate, explicitly selected contract. The
// existing promotion workflow continues to call the schema-1 validator.
export function assertTwoProfileCandidateReceipt(receipt) {
    const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
    const checks = ['imageContract', 'scanAmd64', 'scanArm64', 'nativeAddonArm64', 'lifecycle', 'browser'];
    const fail = () => { throw new Error('Two-profile candidate receipt is missing required immutable release evidence.'); };
    if (!keys(receipt, ['schemaVersion', 'kind', 'version', 'sourceSha', 'applications', 'operatorCandidateImage', 'operatorCandidateDigest', 'tarballFile', 'tarballSha256', 'tarballIntegrity', 'workflowRunId', 'qualifiedAt']) ||
        receipt.schemaVersion !== 2 || !Array.isArray(receipt.applications) || receipt.applications.length !== 2) fail();
    const profiles = ['basic-sqlite-fs', 'clerk-sqlite-s3'];
    for (const profile of profiles) {
        const matching = receipt.applications.filter((entry) => entry?.profile === profile);
        if (matching.length !== 1) fail();
        const app = matching[0];
        const suffix = profile === 'basic-sqlite-fs' ? '' : 'clerk-s3-';
        const expectedImage = `ghcr.io/saluana/or3-chat:candidate-${suffix}${receipt.version}-${receipt.sourceSha}`;
        if (!keys(app, ['profile', 'candidateImage', 'candidateDigest', 'qualification']) || app.candidateImage !== expectedImage || !/^sha256:[0-9a-f]{64}$/.test(app.candidateDigest ?? '')) fail();
        const q = app.qualification;
        if (!keys(q, ['profile', 'sourceSha', 'workflowRunId', 'candidateDigest', 'checks']) ||
            q.profile !== profile || q.sourceSha !== receipt.sourceSha || q.workflowRunId !== receipt.workflowRunId || q.candidateDigest !== app.candidateDigest || !keys(q.checks, checks)) fail();
        for (const check of checks) {
            const result = q.checks[check];
            if (!keys(result, ['result', 'artifactSha256']) || result.result !== 'passed' || !/^[0-9a-f]{64}$/.test(result.artifactSha256 ?? '')) fail();
        }
    }
    const basic = receipt.applications.find((entry) => entry.profile === 'basic-sqlite-fs');
    const launch = receipt.applications.find((entry) => entry.profile === 'clerk-sqlite-s3');
    if (basic.candidateDigest === launch.candidateDigest) fail();
    assertCandidateReceipt({
        schemaVersion: 1, kind: receipt.kind, version: receipt.version, sourceSha: receipt.sourceSha,
        candidateImage: basic.candidateImage, candidateDigest: basic.candidateDigest,
        operatorCandidateImage: receipt.operatorCandidateImage, operatorCandidateDigest: receipt.operatorCandidateDigest,
        tarballFile: receipt.tarballFile, tarballSha256: receipt.tarballSha256, tarballIntegrity: receipt.tarballIntegrity,
        workflowRunId: receipt.workflowRunId, qualifiedAt: receipt.qualifiedAt,
    });
    return receipt;
}
