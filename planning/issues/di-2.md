# Lock Page + Authorization Audit

## 1. Premium Button, Dollar-Store Wiring

**Code**

From `app/components/lock-page/DefaultLockPage.vue`:

```ts
<div v-if="authUiComponent" class="space-y-3">
	<div ref="adapterSlot" class="hidden">
		<component :is="authUiComponent" />
	</div>
	<UButton
		block
		size="xl"
		color="primary"
		:icon="loginIcon"
		class="theme-shadow"
		@click="triggerAdapterSignIn"
	>
		Sign in
	</UButton>
</div>

function triggerAdapterSignIn(): void {
	const btn = adapterSlot.value?.querySelector('button');
	btn?.click();
}
```

**Why this is bad**

This is not an integration. This is DOM grave-robbing. The lock page pretends to be provider-agnostic, then immediately crawls inside a hidden sidebar widget and hopes there is a clickable `<button>` somewhere in there. No contract. No type safety. No guarantee the provider component even renders synchronously, uses a button, or keeps that markup shape.

You built a fake abstraction and then punched straight through it with `querySelector('button')` like the browser is your dependency injection container.

**Real-world consequences**

- A provider refactor can silently break sign-in with zero TypeScript errors.
- A custom auth adapter can register successfully and still produce a dead premium button that does absolutely nothing.
- QA gets a lovely “click Sign in, nothing happens” failure mode with no user-facing error.

**Concrete fix**

Define an actual lock-page/auth action contract instead of scraping DOM.

Example direction:

```ts
export interface AuthUiAdapter {
  id: string;
  sidebarComponent: Component;
  lockPageComponent?: Component;
  openSignIn?: () => void | Promise<void>;
}
```

Then the lock page either renders `lockPageComponent` directly or calls `openSignIn()`. Stop pretending markup is an API.

## 2. Stale Session Cache: Because Apparently Logout Is Optional Now

**Code**

From `app/core/lock-page/access.ts`:

```ts
const cachedPayload = sessionState.data.value;
const cachedSession = cachedPayload?.session ?? null;
const cachedAuthenticated = cachedSession?.authenticated === true;

let hadSessionError = !cachedAuthenticated && Boolean(sessionState.error.value);

try {
	if (!sessionState.data.value && !hadSessionError) {
		await sessionState.refresh();
		hadSessionError = false;
	}
} catch {
	hadSessionError = true;
}
```

And from `tests/unit/lock-page-access-resolve.test.ts`:

```ts
it('keeps authenticated cached sessions allowed when a stale refresh error exists', async () => {
  ...
  await expect(resolveLockPageAccess()).resolves.toMatchObject({
	allowed: true,
	reason: 'authenticated',
  });
});
```

**Why this is bad**

The middleware trusts any cached authenticated session and skips refresh as long as *some* payload exists. So if the user signed out in another tab, lost cookies, or the session expired, the lock page still waves them through because yesterday’s cache said they were cool.

And yes, there’s even a unit test enshrining this behavior, which is always a nice touch when you want a bug to become policy.

**Real-world consequences**

- Signed-out or expired users can still reach the authenticated shell UI until another code path refreshes session state.
- The lock page becomes theater instead of a reliable pre-auth gate.
- You get confusing “UI says I’m in, API says nope” behavior, which is the worst kind of auth bug: not catastrophic enough to fail fast, just irritating enough to waste hours.

**Concrete fix**

For lock-page decisions on protected routes, require a fresh session check unless you have a very recent freshness timestamp.

Example direction:

```ts
if (config.ssrAuthEnabled && config.enabled) {
  await sessionState.refresh();
}
```

If you want to avoid hammering `/api/auth/session`, add a short TTL (`validatedAt`) and only trust cached auth for a few seconds, not indefinitely.

## 3. Hardcoded Route Gating: A Future Bug Factory Wearing Sunglasses

**Code**

From `app/core/lock-page/runtime.ts`:

```ts
export function isProtectedShellRoute(path: string): boolean {
	const normalizedPath = normalizePath(path);
	return (
		normalizedPath === '/' ||
		isSameOrChildPath(normalizedPath, '/chat') ||
		isSameOrChildPath(normalizedPath, '/docs')
	);
}
```

And from `app/middleware/lock-page.global.ts`:

```ts
if (!isProtectedShellRoute(to.path)) {
	return;
}
```

**Why this is bad**

This is a hand-maintained whitelist disguised as a feature. Today it covers `/`, `/chat`, and `/docs`. Tomorrow someone adds another authenticated shell surface or plugin route and forgets to update this function, because of course they will.

The result is predictable: your “lock page” is not a policy layer, it’s a brittle route naming convention with delusions of grandeur.

**Real-world consequences**

- New authenticated routes can bypass the lock page entirely.
- Users get inconsistent pre-auth UX depending on which entry point they hit.
- Teams start believing this is authorization when it’s actually just selective route cosmetics.

**Concrete fix**

Drive this from route meta or a centralized access policy instead of hardcoded path checks.

Example direction:

```ts
definePageMeta({
  requiresShellAuth: true,
});
```

Then the middleware checks route metadata, not a tiny function somebody forgets to update every time the app grows.

## 4. “Custom Lock Page Adapter” Support That Exists Mostly in Your Imagination

**Code**

From `app/core/lock-page/registry.ts`:

```ts
export function registerLockPageAdapter(input: LockPageAdapter): void {
	const id = normalizeAdapterId(input.id);
	if (!id) return;
	lockPageAdapterRegistry.set(id, {
		id,
		component: markRaw(input.component),
	});
}
```

From `app/pages/welcome.vue`:

```ts
const lockPageComponent = computed(() =>
	resolveLockPageComponent(lockPageConfig.adapter, DefaultLockPage)
);
```

Relevant absence across the repo:

- No `$registerLockPageAdapter` Nuxt bridge
- No queue/event fallback like auth UI has
- No provider package registrations
- No non-test usages of `registerLockPageAdapter`

**Why this is bad**

You created a registry with exactly one real consumer and zero runtime registration story. The auth UI registry at least has a bridge pattern for providers. The lock page registry has vibes, unit tests, and wishful thinking.

So the docs say “register a custom lock page adapter,” but the codebase gives external packages no first-class way to do that consistently. That’s not extensibility. That’s a scavenger hunt.

**Real-world consequences**

- Third-party/provider packages cannot reliably hook into the lock page the same way they hook into auth UI.
- The advertised adapter system is effectively app-local only unless someone reaches into internal imports and hopes nothing changes.
- This will rot because unused extension points always rot.

**Concrete fix**

Mirror the existing auth UI registration pattern:

```ts
type LockPageRegistryInput = { id: string; component: unknown };

nuxtApp.$registerLockPageAdapter?.({
  id: 'marketing',
  component,
});
```

Add host-app shims, a queued fallback, and a client plugin that drains queued registrations. Otherwise stop advertising custom adapters like they’re a real platform feature.

## 5. Session Bootstrap Rate Limiting + Silent Lock Page Failure = Self-Inflicted Auth Black Hole

**Code**

From `server/api/auth/session.get.ts`:

```ts
const rateLimitResult = checkSyncRateLimit(clientIP, 'auth:session');

if (!rateLimitResult.allowed) {
	const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
	setResponseHeader(event, 'Retry-After', retryAfterSec);
	throw createError({
		statusCode: 429,
		statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
	});
}
```

And from `app/core/lock-page/access.ts`:

```ts
} catch {
	hadSessionError = true;
}

...

if (hadSessionError) {
	return {
		allowed: false,
		reason: 'session-error',
		session,
	};
}
```

**Why this is bad**

You rate-limit the session bootstrap endpoint by IP, then collapse any fetch failure into “deny access” on the lock page, and then render no dedicated error state. That means a legitimate user can get shoved onto the lock page because of a transient 429 and the UI gives them basically nothing useful beyond existing in their general direction.

Brilliant. The auth system is now capable of DOS-ing its own session resolution and masking it as “not signed in.”

**Real-world consequences**

- Shared-IP environments can get random fake sign-out behavior.
- Users can be trapped on the lock page during transient rate limits or backend hiccups.
- Support/debugging gets harder because auth failures and transport failures are visually conflated.

**Concrete fix**

Differentiate auth absence from auth bootstrap failure.

Example direction:

```ts
if (error?.statusCode === 429 || error?.statusCode >= 500) {
  return {
	allowed: false,
	reason: 'session-error',
	retryAfterMs,
  };
}
```

Then show a real error/retry state on the lock page instead of pretending every failure means “please sign in again.” Also consider a more targeted limiter key than raw IP for authenticated-cookie refresh paths.
