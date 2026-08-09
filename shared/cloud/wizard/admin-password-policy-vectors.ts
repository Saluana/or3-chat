/** Cross-product acceptance vectors for the canonical admin password policy. */
export const ADMIN_PASSWORD_POLICY_VECTORS = [
    { value: 'ValidAdminPassword123', valid: true },
    { value: 'short1A', valid: false },
    { value: 'alllowercasepassword123', valid: false },
    { value: 'ALLUPPERCASEPASSWORD123', valid: false },
    { value: 'NoNumberPassword', valid: false },
] as const;
