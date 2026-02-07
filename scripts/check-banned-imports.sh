#!/usr/bin/env bash
set -euo pipefail

# Guardrail: ensure no direct provider SDK imports leak into core hot zones.
# These zones must only reference providers through the registry/hook system.
#
# Provider-specific code lives in external packages (or3-provider-clerk, or3-provider-convex).
# Core app code must never import directly from provider SDKs.

# Banned patterns:
# 1. Direct provider SDK imports: @clerk/nuxt, convex-vue, from 'convex', from "convex"
# 2. Convex subpath imports: from 'convex/...' or from "convex/..."
# 3. Convex generated code: ~~/convex/_generated
# 4. Old in-repo provider path: packages/or3-provider
# 5. Deep imports into provider internals: or3-provider-*/src/
# 6. Dynamic imports of provider internals: import(.*or3-provider

BANNED_PATTERN='@clerk/nuxt|convex-vue|from '\''convex'\''|from "convex"|from '\''convex/|from "convex/|~~/convex/_generated|packages/or3-provider|or3-provider-[a-z]*/src/|import\(.*or3-provider'

ZONES=(
    app/pages
    app/plugins
    server/api
    server/middleware
    server/plugins
)

# Filter to only existing directories
EXISTING_ZONES=()
for zone in "${ZONES[@]}"; do
    if [ -d "$zone" ]; then
        EXISTING_ZONES+=("$zone")
    fi
done

if [ ${#EXISTING_ZONES[@]} -eq 0 ]; then
    echo "⚠️  No hot zones found to check"
    exit 0
fi

echo "Checking for banned provider imports in core hot zones..."
echo "  Zones: ${EXISTING_ZONES[*]}"
echo "  Pattern: ${BANNED_PATTERN}"
echo ""

# Exclude __tests__ directories — test files may legitimately reference provider packages
if grep -rn --include="*.ts" --include="*.vue" -E "$BANNED_PATTERN" "${EXISTING_ZONES[@]}" | grep -v __tests__ | grep -v node_modules; then
    echo ""
    echo "❌ Banned provider imports found in core hot zones!"
    echo "   Move provider-specific code to the appropriate or3-provider-* package."
    exit 1
fi

echo "✅ No banned provider imports found in core hot zones"
