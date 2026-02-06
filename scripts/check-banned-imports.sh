#!/usr/bin/env bash
set -euo pipefail

# Guardrail: ensure no direct provider SDK imports leak into core hot zones.
# These zones must only reference providers through the registry/hook system.
#
# Provider-specific code lives in external packages (or3-provider-clerk, or3-provider-convex).
# Core app code must never import directly from provider SDKs.

BANNED_PATTERN='@clerk/nuxt|convex-vue|from '\''convex'\''|from "convex"|~~/convex/_generated|packages/or3-provider'

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
