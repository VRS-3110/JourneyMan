# JourneyMan bridge

A tiny Cloudflare Worker that keeps your secrets off the web page. JourneyMan sends Notion and Claude calls here, and the bridge adds the keys and passes them on. The free Cloudflare plan is plenty.

| Route | What it does |
| --- | --- |
| `GET /health` | Says which services are set up |
| `/notion/v1/…` | The handful of Notion API calls JourneyMan makes. Everything else is refused. |
| `POST /ai/messages` | Claude, for the AI features |

Every call must carry `Authorization: Bearer <APP_KEY>`, and browsers may call only from the origins in `ALLOWED_ORIGINS`.

## Set up (about 10 minutes)

1. **Make a Notion integration.** Go to https://www.notion.so/profile/integrations, then New integration (Internal), and copy its secret. In Notion, open each database you want to sync, plus your journal database. Use ••• → Connections and add the integration.

2. **Deploy the bridge** from this folder:

   ```bash
   npx wrangler login
   ```

   ```bash
   npx wrangler deploy
   ```

3. **Set the secrets.** Each command asks for the value:

   ```bash
   npx wrangler secret put APP_KEY
   ```

   ```bash
   npx wrangler secret put NOTION_TOKEN
   ```

   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

   For `APP_KEY`, use a long random password, e.g. the output of `openssl rand -hex 24`. `ANTHROPIC_API_KEY` is only needed for the Claude features.

4. **Allow your app's address.** Edit `ALLOWED_ORIGINS` in `wrangler.toml` to include where JourneyMan runs (your GitHub Pages address, `http://localhost:8000`, and `journeyman://localhost` for the Mac app), then deploy again.

5. **Connect JourneyMan.** In JourneyMan → Connections, paste the worker's URL and your `APP_KEY`, then choose **Test connection**.

## Tests

```bash
node --test worker/test
```

The tests check the key, the origin, the allowed Notion routes and that the token is added.
