# Self-Hosting Convex on Akash

This guide explains how to deploy the Convex backend and dashboard on Akash, configure the required environment variables, and avoid common issues with authentication and file storage.

## Prerequisites

- An Akash account with a funded wallet
- Access to the Akash Console
- The Convex self-hosted images
- A valid SDL file (example below)

---

## 1. Upload and Deploy the SDL

1. Place your SDL file (for example `deploy.yml`) at the root of your project.
2. Upload the SDL file in the Akash Console.
3. Select a provider and deploy.
4. Wait for the deployment to reach a running state.

At this point, Akash will expose public endpoints for your Convex backend:

- Port **3210**: Convex API (Deployment URL)
- Port **3211**: Convex HTTP Actions

---

## 2. Update Backend Environment Variables (Critical)

By default, Convex’s docker-compose file uses localhost. This works only for local Docker and **must be changed on Akash**.

If you do not update these variables, the dashboard will continue to call `127.0.0.1`, and file uploads will fail.

### Before (local Docker defaults)

```env
CONVEX_CLOUD_ORIGIN=http://127.0.0.1:3210
CONVEX_SITE_ORIGIN=http://127.0.0.1:3211
```

### After (Akash public endpoints)

```env
CONVEX_CLOUD_ORIGIN=https://vf689o38n5ear379djomg8ngu8.ingress.akashprovid.com
CONVEX_SITE_ORIGIN=https://vf689o38n5ear379djomg8ngu8.ingress.akashprovid.com:3211
```

**What these mean**

- `CONVEX_CLOUD_ORIGIN`
  Public URL of the Convex backend API (port 3210).
  This is the Deployment URL advertised to clients and the dashboard.
- `CONVEX_SITE_ORIGIN`
  Public URL for HTTP Actions (port 3211).

These must point to the **backend**, not the dashboard, and never to localhost or service names.

After updating them, redeploy the backend.

---

## 3. Configure the Convex Dashboard

The dashboard is a browser application and must also know the public backend URL.

Set the following environment variable on the **convex-dashboard** service:

```env
NEXT_PUBLIC_DEPLOYMENT_URL=https://vf689o38n5ear379djomg8ngu8.ingress.akashprovid.com
```

Redeploy the dashboard after changing this value.
Because this is a `NEXT_PUBLIC_*` variable, it is baked into the frontend bundle at startup.

---

## 4. Generate an Admin Key

The admin key is **not** `INSTANCE_SECRET`.

To log in to the Convex dashboard, you must generate an admin key from the backend.

1. Open the Akash Console.
2. Open a shell into the `convex-backend` container.
3. Run:

    ```sh
    ./generate_admin_key.sh
    ```

4. Copy the generated admin key.

You will use:

- **Deployment URL**: the public 3210 URL
- **Admin Key**: output of the script above

---

## 5. Configure Your Application Environment

Once you have the public endpoint URLs from Akash, update your application’s environment files.

### Required variables

Set these in both `.env` and `.env.local`:

```env
CONVEX_SELF_HOSTED_URL=https://vf689o38n5ear379djomg8ngu8.ingress.akashprovid.com
CONVEX_SELF_HOSTED_ADMIN_KEY=<admin key from generate_admin_key.sh>
```

### Convex client configuration

Ensure your frontend Convex client uses the same URL:

```env
VITE_CONVEX_URL=https://vf689o38n5ear379djomg8ngu8.ingress.akashprovid.com
```

Restart your development server after making these changes.

---

## 6. Persistent Storage and File Uploads

- Self-hosted Convex **does not require S3** to work.
- File storage works using local disk as long as:
    - A persistent volume is mounted
    - The volume is mounted at `/convex/data`

If `CONVEX_CLOUD_ORIGIN` is left pointing at localhost, file uploads will fail with:

- `ERR_BLOCKED_BY_CLIENT`
- “Uploaded file appears to be HTML content”

This happens because the browser attempts to upload to `127.0.0.1`, not Akash.

---

## Common Pitfalls

- Using `INSTANCE_SECRET` as the dashboard admin key
  This will never work.
- Leaving `CONVEX_CLOUD_ORIGIN` or `CONVEX_SITE_ORIGIN` set to localhost
  This breaks uploads and causes confusing dashboard behavior.
- Pointing backend origin variables at the dashboard URL
  These must point to the backend itself.
- Changing env vars via shell without redeploying
  Convex reads these at startup. A redeploy is required.

---

## Summary

- Deploy the SDL
- Replace localhost origins with Akash public endpoints
- Redeploy backend and dashboard
- Generate an admin key via `./generate_admin_key.sh`
- Update your app’s environment variables
- Restart your dev server

With these steps in place, Convex runs correctly on Akash with working authentication and file storage.
