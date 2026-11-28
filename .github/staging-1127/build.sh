#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(git rev-parse HEAD^)" = "$APP_SHA"
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
ctx="$root/context"
mkdir "$ctx" "$DATA"
git archive "$APP_SHA" | tar -xf - -C "$ctx"
git fetch --no-tags --depth=1 origin "$SECURITY_SHA"
test "$(git rev-parse FETCH_HEAD)" = "$SECURITY_SHA"
git archive "$SECURITY_SHA" scripts/docker/vendor/libzstd | tar -xf - -C "$ctx"
git show "$SECURITY_SHA:Dockerfile" >"$root/security-dockerfile"
git init -q "$root/provider"
git -C "$root/provider" remote add origin https://github.com/Saluana/or3-provider-clerk.git
git -C "$root/provider" fetch --quiet --no-tags --depth=1 origin "$CLERK_SHA"
git -C "$root/provider" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$root/provider" rev-parse HEAD)" = "$CLERK_SHA"
(
  cd "$root/provider"
  bun install --frozen-lockfile --ignore-scripts
  bun run type-check:standalone
  bun run build
  npm pack --ignore-scripts --pack-destination "$root"
)
cp "$root/or3-provider-clerk-0.0.12.tgz" "$ctx/provider-candidate.tgz"
tar -xOzf "$ctx/provider-candidate.tgz" package/dist/runtime/plugins/session-logout-bridge.client.js | grep -F 'autoLoad: false' >/dev/null
tar -xOzf "$ctx/provider-candidate.tgz" package/dist/runtime/plugins/session-logout-bridge.client.js | grep -F 'sessionId === observedSessionId' >/dev/null
clerk_digest=$(sha256sum "$ctx/provider-candidate.tgz" | cut -d' ' -f1)
python3 - "$ctx" "$root/security-dockerfile" "$clerk_digest" <<'PY'
from pathlib import Path
import sys
ctx, source, clerk = sys.argv[1:]
docker = Path(ctx) / 'Dockerfile'
s = docker.read_text()
release = Path(source).read_text()
end = 'ENV NODE_ENV=production '
new_start = '# Node supplies its own TLS.'
old_start = '# The distroless runtime keeps only Node'
assert s.count(old_start) == s.count(end) == release.count(new_start) == release.count(end) == 1
s = s[:s.index(old_start)] + release[release.index(new_start):release.index(end)] + s[s.index(end):]
point = 'RUN node scripts/docker/prepare-backup-inspection.mjs'
assert s.count(point) == 1
provider = (
    f"RUN echo '{clerk}  provider-candidate.tgz' | sha256sum -c - && "
    "mkdir /tmp/provider-candidate && tar --no-same-owner -xzf provider-candidate.tgz -C /tmp/provider-candidate && "
    "node -e 'const a=require(\"./node_modules/or3-provider-clerk/package.json\"),b=require(\"/tmp/provider-candidate/package/package.json\"); "
    "for (const k of [\"name\",\"version\",\"dependencies\",\"peerDependencies\"]) if (JSON.stringify(a[k])!==JSON.stringify(b[k])) throw new Error(\"provider dependency differs: \"+k)' && "
    "test -d /tmp/provider-candidate/package/dist && rm -rf node_modules/or3-provider-clerk/dist && "
    "cp -R /tmp/provider-candidate/package/dist node_modules/or3-provider-clerk/dist\n"
)
s = s.replace(point, provider + point)
copy = 'COPY . .\n'
assert s.count(copy) == 1
s = s.replace(copy, copy + 'RUN npm install --prefix packages/hosted-billing --ignore-scripts --package-lock=false --no-audit --no-fund\n')
arg = 'ARG SSR_AUTH_ENABLED=false\n'
assert s.count(arg) == 1
s = s.replace(arg, 'ENV OR3_HOSTED_BILLING_ENABLED=true OR3_WORKFLOWS_ENABLED=false OR3_WORKFLOWS_EDITOR=false OR3_WORKFLOWS_SLASH_COMMANDS=false OR3_WORKFLOWS_EXECUTION=false OR3_SITE_NAME="OR3 Staging" OR3_DISABLED_THEMES=cyberpunk\n' + arg)
docker.write_text(s)
PY
docker buildx build --platform linux/amd64 --load --target runtime --tag "$IMAGE_TAG" \
  --label "org.opencontainers.image.revision=$APP_SHA" --label "org.opencontainers.image.version=final-${APP_SHA:0:12}-clerk" \
  --label "or3.staging.clerk-revision=$CLERK_SHA" --label "or3.staging.clerk-tarball-sha256=$clerk_digest" \
  --label "or3.staging.runtime-security-overlay-revision=$SECURITY_SHA" \
  --build-arg OR3_DOCKER_PROFILE=clerk-sqlite-s3 \
  --build-arg SSR_AUTH_ENABLED=true --build-arg AUTH_PROVIDER=clerk \
  --build-arg OR3_GUEST_ACCESS_ENABLED=false --build-arg OR3_AUTH_REGISTRATION_MODE=invite_only \
  --build-arg OR3_AUTH_AUTO_PROVISION=false --build-arg OR3_SYNC_ENABLED=true --build-arg OR3_SYNC_PROVIDER=sqlite \
  --build-arg OR3_ERROR_DIAGNOSTICS_ENABLED=true --build-arg OR3_STORAGE_ENABLED=true --build-arg NUXT_PUBLIC_STORAGE_PROVIDER=s3 "$ctx"
test "$(docker inspect --type image --format '{{.Os}}/{{.Architecture}}' "$IMAGE_TAG")" = linux/amd64
docker run --rm --network none --entrypoint /nodejs/bin/node "$IMAGE_TAG" -e '
  const fs = require("node:fs");
  const proof = fs.readFileSync("/var/lib/dpkg/status.d/libzstd1", "utf8");
  if (!proof.includes("Version: 1.5.7+dfsg-1+deb13u1")) process.exit(1);
  const assets = "/app/.output/public/_nuxt";
  const found = fs.readdirSync(assets).filter(n => n.endsWith(".js")).some(n =>
    fs.readFileSync(assets+"/"+n, "utf8").includes("[clerk-session-bridge] Could not refresh workspace session"));
  if (!found) throw new Error("Clerk #6 marker missing from shipped browser assets");
  const sheet = fs.readdirSync(assets).filter(n => n.endsWith(".js")).some(n => fs.readFileSync(assets+"/"+n, "utf8").includes("h-[min(88svh,720px)]"));
  if (!sheet) throw new Error("Mobile Chat Settings sheet marker missing");
  const picker = fs.readdirSync(assets).filter(n => n.endsWith(".js")).some(n => fs.readFileSync(assets+"/"+n, "utf8").includes("Search system prompts"));
  if (!picker) throw new Error("System prompts picker marker missing");

'
image_id=$(docker inspect --type image --format '{{.Id}}' "$IMAGE_TAG")
docker save "$IMAGE_TAG" -o "$root/candidate.tar"
trivy image --input "$root/candidate.tar" --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --timeout 10m --format json --output "$root/scan.json"
archive_sha=$(sha256sum "$root/candidate.tar" | cut -d' ' -f1)
gzip -1c "$root/candidate.tar" | openssl cms -encrypt -binary -stream -outform DER -aes-256-gcm \
  -out "$DATA/staging-candidate.cms" .github/staging-1127/recipient.pem
encrypted_sha=$(sha256sum "$DATA/staging-candidate.cms" | cut -d' ' -f1)
test -s "$DATA/staging-candidate.cms"
jq -n --arg app "$APP_SHA" --arg clerk "$CLERK_SHA" --arg clerk_digest "$clerk_digest" \
  --arg security "$SECURITY_SHA" --arg image "$image_id" --arg tag "$IMAGE_TAG" --arg archive "$archive_sha" \
  --arg encrypted "$encrypted_sha" --arg run "$GITHUB_RUN_ID" \
  '{app_source:$app,clerk_source:$clerk,clerk_tarball_sha256:$clerk_digest,runtime_security_overlay:$security,
    image_id:$image,image_tag:$tag,platform:"linux/amd64",archive_sha256:$archive,encrypted_sha256:$encrypted,
    github_run:$run,scan:"Trivy v0.70.0: zero HIGH/CRITICAL; no suppression",clerk_browser_marker_verified:true,
    runtime_libzstd_inventory:"1.5.7+dfsg-1+deb13u1",runtime_credentials:"none",published:false}' >"$DATA/receipt.json"
cat "$DATA/receipt.json"
