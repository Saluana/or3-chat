- Upload yaml file in root dir of project
- Select a provider and deploy
- Once you have the address of your deployment modify the SDL enviroment variables to include the new endpoints.
- To login to the akash dashboard you will need the deployment URL and the admin key. You can get it by running `./generate_admin_key.sh` in the shell on akash console.
- if you do not change the SDL enviroment variables the file storage will not work.

Before:
{insert example}

After:

```env
CONVEX_CLOUD_ORIGIN=https://vf689o38n5ear379djomg8ngu8.ingress.akashprovid.com
CONVEX_SITE_ORIGIN=https://vf689o38n5ear379djomg8ngu8.ingress.akashprovid.com:3211
```

- Once you get the endpoint URLs from Akash, set the following environment variables in your `.env` and `.env.local` files:
    - `CONVEX_SELF_HOSTED_URL` - Set this to the endpoint URL provided by Akash for your Convex deployment.
    - `CONVEX_SELF_HOSTED_ADMIN_KEY` - Set this to the admin key provided by Akash for your Convex deployment.
- Update `VITE_CONVEX_URL` in both `.env` and `.env.local` to match `CONVEX_SELF_HOSTED_URL`.
- Restart your development server to apply the changes.
