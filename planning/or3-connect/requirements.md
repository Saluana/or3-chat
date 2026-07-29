# OR3 Connect requirements

- `npx or3 connect` is the normal setup: no pasted tokens, VPN, tunnel account, or QR required.
- Remote mode requires an authenticated OR3 Cloud account; offline/local mode remains account-free and exposes no remote controls.
- macOS and Linux stay reachable after logout/reboot after one explicit administrator approval.
- A browser device flow shows the same short code in terminal and browser.
- Each computer is account/workspace bound, named, limited, revocable, and independently addressable.
- Tunnel, service, and provider internals never appear in normal UI or logs.
- Cloudflare Tunnel provides reachability only; the OR3 host remains loopback-bound and bearer authenticated.
- Secrets are owner-only at rest, excluded from process arguments, encrypted in cloud persistence, and redacted from errors.

## Acceptance

1. New users run one command, sign in, approve the matching code, and see the computer in Agents.
2. Reloading OR3 rehydrates cloud computers without a PIN or pasted credential.
3. Disconnect revokes the tunnel and removes the persistent service.
4. Local agent usage is unchanged when OR3 Connect is disabled.
