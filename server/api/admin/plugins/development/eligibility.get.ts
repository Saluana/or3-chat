/**
 * GET /api/admin/plugins/development/eligibility
 *
 * Purpose:
 * Tell the admin UI whether this instance may admit development candidates,
 * and why not. Read-only operator status: identities and reason codes only.
 */
import { defineEventHandler } from 'h3';
import { requireAdminApiContext } from '../../../../admin/api';
import {
    developmentIneligibilityHelp,
    resolvePluginDevelopmentEligibility,
} from '../../../../utils/plugins/development/development-eligibility';

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, {
        ownerOnly: true,
        superAdminOnly: true,
    });
    const eligibility = resolvePluginDevelopmentEligibility(event);
    return {
        eligible: eligibility.eligible,
        reasons: eligibility.reasons,
        help: eligibility.reasons.map(developmentIneligibilityHelp),
    };
});
