// This file deliberately does not match the V1 client-entry glob. The build
// verifier proves it never crosses into public or server executable output.
export const NON_CLIENT_FIXTURE_SENTINEL = 'or3-v1-build-fixture:must-not-bundle';
