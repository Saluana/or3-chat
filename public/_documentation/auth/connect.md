# Connect OpenRouter

OpenRouter provides access to AI models. Model usage may cost money, depending on the model; creating an API key does not make paid models free. Check pricing in OpenRouter before chatting.

OpenRouter models need an OpenRouter key. A Cloud operator can supply an instance key instead, and controls whether users can override it with their own keys. Connecting OpenRouter does not sign you into OR3 Cloud. OR3 also supports [direct OpenAI keys](/documentation/auth/reference#direct-openai-keys) when an OR3 server is available.

## Connect through OpenRouter

1. Use **Connect with OpenRouter** on the empty chat welcome card, or **Connect** in the sidebar.
2. If the instance requests OR3 sign-in, complete that first.
3. Complete the OpenRouter authorization flow in the browser.
4. Return through OR3's callback page, then select a model and send a message.

OR3 uses S256 PKCE to exchange the returned code for a key. In local mode, this also works on HTTP development origins where Web Crypto is unavailable; the verifier is kept in browser session storage, with a localStorage fallback for redirect recovery. In Cloud mode, the server owns the transaction. Use the same browser and OR3 origin throughout the flow.

## Paste an existing key

Expand **Use an existing API key** on the welcome card to enter a key starting with `sk-or-`. OR3 checks its format before saving it: local mode uses the browser's Dexie KV table, while Cloud stores it in the account secret vault. Format validation does not prove that the key is active, funded, or permitted to use a particular model; the model request can still fail.

Use **How your API key is handled** on the welcome card for a short explanation of storage and requests. The saved personal key is excluded from workspace sync. In local mode, requests can send it through the OR3 server or directly to OpenRouter if that route is unavailable. In Cloud mode, the server retrieves the account credential from the vault and forwards requests to OpenRouter.

When background streaming is enabled, the server can also keep encrypted credentials for the job. Storage and retention depend on the configured provider.

IndexedDB persistence is browser storage, not an encrypted credential vault. Keep keys out of logs, screenshots, and shared code. A locally saved key is not an operator's server key or an OR3 sign-in credential.

## Disconnect

Use the sidebar's **Disconnect** control to remove the personal connection. In local mode this clears the browser key and legacy localStorage key; in Cloud it requests removal from the account vault and reports a failure if the server cannot confirm it. Disconnect does not revoke the key at OpenRouter, sign out of OR3 Cloud, or delete conversations. On an instance with server credentials, those credentials may still provide model access.

## Troubleshooting

Cloud checks saved connection metadata after the page mounts and when it comes
back online or becomes visible. A failed background check does not show a toast
on each load or over the connection dialog. Errors from **Connect**, saving a
key, or an approved legacy-key migration remain visible. A failed migration
keeps the browser copy so you can retry the connection safely.

| Symptom | Recovery |
| --- | --- |
| OR3 asks you to sign in | The Cloud instance requires an authenticated session before linking OpenRouter. |
| Callback says the verifier is missing | Start a fresh Connect flow from the same browser and origin; do not reuse an old callback URL. |
| State check fails | Select **Try again** to start a fresh connection; do not reuse a callback from another attempt. |
| Code exchange fails or times out | Start a fresh flow. Authorization codes are single use, and OR3 deliberately does not retry the exchange automatically. |
| A request reports invalid credentials or insufficient access | Check the provider account/key, then reconnect or replace the personal key as appropriate. |
| Redirect reaches the wrong host or port | Return to the correct OR3 URL. Source developers should check the runtime redirect configuration and the URL printed by the dev wrapper. |
| Connection vanishes after reload | Stay on the same browser profile and origin. Check that storage is available and saving the key succeeded. |

Localhost is suitable for source development. Public deployments should use HTTPS so browser cryptography and redirects work reliably. If the app reports a network or content-security-policy error, fix that cause before beginning another authorization flow; repeatedly reusing a failed code will not repair it.

In Cloud mode, the server validates an account-bound, ten-minute HttpOnly
transaction cookie and exchanges the code before saving the key in the account's
secret vault. A failed callback logs `[openrouter-oauth] Connection failed` with
the stage: `callback-validation`, `code-exchange` (or its HTTP status),
`exchange-response`, or `credential-storage`. It also reports whether the session,
workspace, and transaction cookie were present. Codes, cookie values, API keys,
and upstream response bodies are excluded. Check these server diagnostics and
deep provider health to distinguish a rejected callback from an exchange or
credential-storage outage.

The failure page offers **Try again** and **Back to OR3**. **Continue** appears only after a successful connection. Source developers preparing a manual preview must build with `OR3_PRODUCTION_JOURNEY_TEST_HARNESS=false`; that harness replaces OpenRouter with a local test endpoint for automated journeys and is unsuitable for real account connections. If network requests go to `/api/__or3-e2e`, rebuild with the harness disabled and reload the preview.

See [connection API details](/documentation/auth/reference) for the implementation and [Cloud troubleshooting](/documentation/cloud/troubleshooting) for instance-side problems.
