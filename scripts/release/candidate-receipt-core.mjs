export function assertCandidateReceipt(value) {
    const receipt = value;
    const expectedCandidate = receipt?.version && receipt?.sourceSha
        ? `ghcr.io/saluana/or3-chat:candidate-${receipt.version}-${receipt.sourceSha}`
        : '';
    const expectedOperatorCandidate = receipt?.version && receipt?.sourceSha
        ? `ghcr.io/saluana/or3-chat:candidate-operator-${receipt.version}-${receipt.sourceSha}`
        : '';
    if (
        !receipt ||
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
