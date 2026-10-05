# Connect OpenRouter

OpenRouter provides access to AI models. Model usage may cost money, depending on the model; creating an API key does not make paid models free. Check pricing in OpenRouter before chatting.

A local-first OR3 session needs an OpenRouter key to generate responses. A Cloud operator can supply an instance key instead, and controls whether users can override it with their own keys. Connecting OpenRouter does not sign you into OR3 Cloud.

## Connect through OpenRouter

1. Use **Connect with OpenRouter** on the empty chat welcome card, or **Connect** in the sidebar.
2. If the instance requests OR3 sign-in, complete that first.
3. Complete the OpenRouter authorization flow in the browser.
4. Return through OR3's callback page, then select a model and send a message.

OR3 uses PKCE to exchange the returned code for a key. The verifier is kept in browser session storage, with a localStorage fallback for redirect recovery. Use the same browser and OR3 origin throughout the flow.

## Paste an existing key

Expand **Use an existing API key** on the welcome card to enter a key starting with `sk-or-`. OR3 checks its format and saves it in the browser's Dexie KV table before updating the connected state. Format validation does not prove that the key is active, funded, or permitted to use a particular model; the model request can still fail.

Use **How your API key is handled** on the welcome card for a short explanation of storage and requests. The saved personal key is excluded from workspace sync. AI requests still send it to OpenRouter: the browser first tries the OR3 server route, which receives the key and forwards it to OpenRouter when user keys are allowed. If that route is unavailable, requests with a personal key can go directly to OpenRouter. Browser storage does not mean the key never leaves the browser.

When background streaming is enabled, the server can also keep encrypted credentials for the job. Storage and retention depend on the configured provider.

IndexedDB persistence is browser storage, not an encrypted credential vault. Keep keys out of logs, screenshots, and shared code. A locally saved key is not an operator's server key or an OR3 sign-in credential.

## Disconnect

Use the sidebar's **Disconnect** control to clear the personal key from OR3's persisted storage and reactive state. It also removes the legacy localStorage key. Disconnect does not revoke the key at OpenRouter, sign out of OR3 Cloud, or delete conversations. On an instance with server credentials, those credentials may still provide model access.

## Troubleshooting

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

The failure page offers **Try again** and **Back to OR3**. **Continue** appears only after a successful connection. Source developers preparing a manual preview must build with `OR3_PRODUCTION_JOURNEY_TEST_HARNESS=false`; that harness replaces OpenRouter with a local test endpoint for automated journeys and is unsuitable for real account connections. If network requests go to `/api/__or3-e2e`, rebuild with the harness disabled and reload the preview.

See [connection API details](/documentation/auth/reference) for the implementation and [Cloud troubleshooting](/documentation/cloud/troubleshooting) for instance-side problems.
