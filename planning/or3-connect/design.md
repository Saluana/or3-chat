# OR3 Connect design

```text
npx or3 connect
  → verified or3-intern + cloudflared
  → short-lived device authorization
  → authenticated /connect confirmation
  → account-bound Convex environment record
  → server-only Cloudflare named tunnel provisioning
  → launchd/systemd supervisor
  → Agents hydrates the remote host from OR3 Cloud
```

- Nitro is the public protocol boundary. Convex functions are internal-only.
- Device and control secrets are SHA-256 domain-separated before lookup.
- One-time credentials are AES-256-GCM encrypted with `OR3_CONNECT_ENCRYPTION_KEY`.
- Cloudflare API credentials are server-only. Named tunnel ingress targets `127.0.0.1:9100`; unmatched ingress returns 404.
- The host stores tunnel credentials in a separate `0600` token file and invokes `cloudflared --token-file`.
- launchd/systemd runs as the invoking user. Root is used only to install/remove the service definition.
- OR3 Chat fetches active account environments with `no-store`, restores access tokens into the existing session-only agent vault, and reuses the existing agent conversation UI.
