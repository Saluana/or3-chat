#!/bin/sh
set -eu

# Nuxt can only override built runtimeConfig values through NUXT_* variables.
# Preserve OR3's documented environment contract for prebuilt containers by
# translating those values at process startup. Explicit NUXT_* values win.

auth_enabled=${SSR_AUTH_ENABLED:-false}
auth_provider=${OR3_AUTH_PROVIDER:-${AUTH_PROVIDER:-clerk}}
guest_access_enabled=${OR3_GUEST_ACCESS_ENABLED:-false}

sync_enabled=${OR3_CLOUD_SYNC_ENABLED:-${OR3_SYNC_ENABLED:-false}}
sync_provider=${OR3_SYNC_PROVIDER:-convex}

storage_enabled=${OR3_CLOUD_STORAGE_ENABLED:-${OR3_STORAGE_ENABLED:-false}}
storage_provider=${OR3_STORAGE_PROVIDER:-${NUXT_PUBLIC_STORAGE_PROVIDER:-convex}}

admin_username=${OR3_ADMIN_USERNAME:-}
admin_password=${OR3_ADMIN_PASSWORD:-}
admin_jwt_secret=${OR3_ADMIN_JWT_SECRET:-}
admin_jwt_expiry=${OR3_ADMIN_JWT_EXPIRY:-24h}

# The fast self-hosted setup creates a Basic Auth signing secret but does not
# need a second, separately managed admin secret. Derive a domain-separated
# admin signing key when one was not explicitly supplied.
if [ -z "$admin_jwt_secret" ] && [ -n "${OR3_BASIC_AUTH_JWT_SECRET:-}" ]; then
    admin_jwt_secret=$(printf 'or3-admin:%s' "$OR3_BASIC_AUTH_JWT_SECRET" | sha256sum | awk '{print $1}')
fi

if [ -z "${NUXT_AUTH_ENABLED+x}" ]; then
    export NUXT_AUTH_ENABLED="${auth_enabled}"
fi
if [ -z "${NUXT_AUTH_PROVIDER+x}" ]; then
    export NUXT_AUTH_PROVIDER="${auth_provider}"
fi
if [ -z "${NUXT_PUBLIC_SSR_AUTH_ENABLED+x}" ]; then
    export NUXT_PUBLIC_SSR_AUTH_ENABLED="${auth_enabled}"
fi
if [ -z "${NUXT_PUBLIC_AUTH_PROVIDER+x}" ]; then
    export NUXT_PUBLIC_AUTH_PROVIDER="${auth_provider}"
fi
if [ -z "${NUXT_PUBLIC_GUEST_ACCESS_ENABLED+x}" ]; then
    export NUXT_PUBLIC_GUEST_ACCESS_ENABLED="${guest_access_enabled}"
fi

if [ -z "${NUXT_SYNC_ENABLED+x}" ]; then
    export NUXT_SYNC_ENABLED="${sync_enabled}"
fi
if [ -z "${NUXT_SYNC_PROVIDER+x}" ]; then
    export NUXT_SYNC_PROVIDER="${sync_provider}"
fi
if [ -z "${NUXT_PUBLIC_SYNC_ENABLED+x}" ]; then
    export NUXT_PUBLIC_SYNC_ENABLED="${sync_enabled}"
fi
if [ -z "${NUXT_PUBLIC_SYNC_PROVIDER+x}" ]; then
    export NUXT_PUBLIC_SYNC_PROVIDER="${sync_provider}"
fi

if [ -z "${NUXT_STORAGE_ENABLED+x}" ]; then
    export NUXT_STORAGE_ENABLED="${storage_enabled}"
fi
if [ -z "${NUXT_STORAGE_PROVIDER+x}" ]; then
    export NUXT_STORAGE_PROVIDER="${storage_provider}"
fi
if [ -z "${NUXT_PUBLIC_STORAGE_ENABLED+x}" ]; then
    export NUXT_PUBLIC_STORAGE_ENABLED="${storage_enabled}"
fi
if [ -z "${NUXT_PUBLIC_STORAGE_PROVIDER+x}" ]; then
    export NUXT_PUBLIC_STORAGE_PROVIDER="${storage_provider}"
fi

if [ -z "${NUXT_ADMIN_AUTH_USERNAME+x}" ]; then
    export NUXT_ADMIN_AUTH_USERNAME="${admin_username}"
fi
if [ -z "${NUXT_ADMIN_AUTH_PASSWORD+x}" ]; then
    export NUXT_ADMIN_AUTH_PASSWORD="${admin_password}"
fi
if [ -z "${NUXT_ADMIN_AUTH_JWT_SECRET+x}" ]; then
    export NUXT_ADMIN_AUTH_JWT_SECRET="${admin_jwt_secret}"
fi
if [ -z "${NUXT_ADMIN_AUTH_JWT_EXPIRY+x}" ]; then
    export NUXT_ADMIN_AUTH_JWT_EXPIRY="${admin_jwt_expiry}"
fi

exec "$@"
