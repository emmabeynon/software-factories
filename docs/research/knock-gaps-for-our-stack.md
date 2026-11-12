# Research: Knock gaps for our stack

Issue: emmabeynon/software-factories#9 (map: #1). Follows `docs/research/knock-in-app-notifications.md` (branch `research/knock-in-app-notifications`). Sources are Knock's own docs, pricing page, changelog and Knock's first-party GitHub repo (`knocklabs/javascript`), fetched 2026-11-12. Facts only; anything inferred or unanswered is marked **[inferred]** or **[unanswered]**.

## 1. SSR behaviour of the embedded feed and headless hooks; React Router guidance

- **[unanswered] No Knock docs page covers SSR for the feed or hooks.** The docs index (https://docs.knock.app/llms.txt) lists no SSR page. The React SDK overview (https://docs.knock.app/in-app-ui/react/sdk/overview.md), React overview (https://docs.knock.app/in-app-ui/react/overview), feed page (https://docs.knock.app/in-app-ui/react/feed) and inbox page (https://docs.knock.app/in-app-ui/react/inbox) do not mention SSR, hydration, React Router, or `'use client'`.
- **No React Router guidance found.** The only framework quick starts listed are React and Next.js (https://docs.knock.app/getting-started/quick-start/react, .../nextjs).
- Next.js quick start (https://docs.knock.app/getting-started/quick-start/nextjs.md): the inbox file starts with `"use client";` ("Since this file uses client-side React APIs, it will need to be a client component"); the workflow trigger runs in a `"use server"` server action. It does not discuss hydration or client-only rendering.
- `@knocklabs/react` README (https://github.com/knocklabs/javascript/tree/main/packages/react): "these components are designed to be used via React for web only." `KnockProvider` takes an `enabled` prop (default `true`); when `false` the provider still renders children but does not identify the user, make API requests, or open a websocket. Headless example uses `useAuthenticatedKnockClient`, `useNotifications`, `useNotificationStore`. The README does not mention SSR, `identificationStrategy`, or `'use client'`.
- **[inferred]** The `enabled` prop is the documented way to defer all network activity, so it could be used to keep the client idle until after hydration (e.g. `enabled` set true in an effect). Knock does not say this is for SSR.
- Not first-party, so not relied on: community GitHub issues report `KnockProvider` authenticating during server render (sending an identify call) and suggest `identificationStrategy="skip"` or `enabled`. Unverified against Knock docs.

## 2. Knock down or rate limiting: trigger calls and the feed

**Rate limits** (https://docs.knock.app/api-reference/overview/rate-limits)
- Over-limit requests get `429 Too Many Requests`. Tiers are assigned per endpoint. Scope: API key = per endpoint per environment; signed user token = per environment and signing user.
- Tier values present on the page: 1, 5, 60, 200, 1,000 requests/second.
- **[unanswered] The tier-to-endpoint mapping, so the trigger endpoint's limit, did not render in the fetched page content** (table markup broken in the fetch, twice). The trigger page (https://docs.knock.app/send-notifications/triggering-workflows/api) does not state a limit either. Check the live page in a browser or ask Knock.
- Batch/bulk endpoints may have an extra limit ("1 update / second / entity" fragment); a rate-limited batch still returns 2xx with an `x-ratelimited-{param}` header listing rejected values (https://docs.knock.app/reference).
- No `Retry-After` or general rate-limit headers are documented; no backoff guidance. Knock says to contact them if concerned about limits (https://docs.knock.app/reference).
- Trigger payload limits: up to 1000 recipients per trigger, `data` capped at 10MB, no bulk trigger (trigger page above).

**Trigger calls when Knock fails**
- `Idempotency-Key` header (up to 255 chars) is honoured only by `POST /workflows/:key/trigger`. Same key within 24 hours returns the original response; mismatched parameters return an error. Only 2xx responses are cached, so a retry after a 4xx/5xx re-runs the request. Replays carry `idempotent-replayed: true` (https://docs.knock.app/reference, https://docs.knock.app/send-notifications/triggering-workflows/api).
- **[unanswered]** What the trigger endpoint does during a Knock outage, whether it queues or retries internally, and any recommended client retry intervals. No docs page on this; the docs index lists no status/reliability page. Pricing page lists a 99.9% uptime SLA on Free (https://knock.app/pricing).
- **[inferred]** Because Knock does not queue calls that fail to reach it, our server must retry (with a stable idempotency key) or persist the intent itself.
- Unrelated retries documented elsewhere (workflow step retries, provider delivery retries) concern Knock's calls out, not our calls in.

**Feed when Knock is down**
- **[unanswered]** The feed/overview pages say nothing about failure, offline or reconnect-on-error behaviour. Documented socket behaviour only: `auto_manage_socket_connection` (off by default) disconnects inactive tabs after `auto_manage_socket_connection_delay` (default 2000 ms) and reconnects on focus (https://docs.knock.app/in-app-ui/react/feed).

## 3. Bulk export of users or messages

- No self-serve bulk export endpoint found. API list methods are cursor-paginated; bulk endpoints cover identify, set-preferences and delete, not export (https://docs.knock.app/api-reference/overview).
- Warehouse export extension (https://docs.knock.app/integrations/extensions/warehouse-export.md): exports messages (backfill of all historical message data available), message events (previous 90 days on initial backfill), and a recipients change stream (users only; 7-day event retention; initial snapshot of current state). Destinations include BigQuery, Snowflake, Redshift, S3, GCS, Postgres, Google Sheets and others. Syncs daily by default (1/6/12-hour on request). Setup is via support.
- **Plan: "available exclusively with our Enterprise plan."** So not available on Free.
- Message logs are retained 30 days outside Enterprise; feed items are retained indefinitely and stay fetchable via API (https://docs.knock.app/manage-your-account/data-retention). **[inferred]** On Free, paging a user's messages via the list API is the only export route, subject to that retention.
- The "Warehouse sync" changelog entry (2026-11-10) is the reverse direction, warehouse into Knock (https://knock.app/changelog).

## 4. Knock branding on the free plan; headless UI

- Pricing page: Free plan "Remove Knock branding" = No; Starter removes it (https://knock.app/pricing).
- **[unanswered]** Where branding appears for in-app UI. The feed, inbox and React overview pages do not mention "Powered by Knock" or any prop to hide it. Docs index branding pages cover email layouts, tenants and preference center only (https://docs.knock.app/llms.txt).
- **[unanswered]** Whether a headless UI shows branding. Docs say headless means "bring your own UI" via hooks, with no mention of branding. **[inferred]** A fully custom UI renders none of Knock's markup, but Knock does not state this; confirm with Knock or on the live prebuilt component.

## 5. Feed history retention on the free plan

- Feed items: "In-app feed notifications are available indefinitely"; they remain fetchable and updatable after message log data expires (https://docs.knock.app/manage-your-account/data-retention).
- Pricing page, Free: feed retention "No limit, but can be configured" (https://knock.app/pricing).
- Message/delivery logs, audit logs, workflow run logs: "All other plans" (includes Free): 30 days. API logs: 30 days on every plan (data-retention page).
- The account retention page does not name "Free" explicitly; Free falls under "All other plans" **[inferred]** from that wording, and the pricing page confirms 30-day Free log retention.

## 6. Mapping a Cadence user to a Knock user

- User `id` is the only required property; Knock recommends your internal stable identifier (https://docs.knock.app/concepts/users, https://docs.knock.app/managing-recipients/identifying-recipients).
- Constraints: max 256 characters; cannot contain `/` or `#`; "You cannot change a user's id once it has been set" (so avoid emails/phone numbers) (https://docs.knock.app/concepts/users).
- Identify is an upsert; existing data is merged (identifying-recipients page). Passing a user object with `id` inline in a trigger creates the user if missing (https://knock.app/blog/how-to-add-an-in-app-notification-feed-to-nextjs-15, first-party blog).
- Guests: use a prefix such as `guest_` then merge into the registered user to keep history (concepts/users). Deleting a user removes them as recipient/actor; their in-app messages show a "missing user" marker.
- **[inferred]** Cadence's own user primary key satisfies these constraints if it contains no `/` or `#` and is stable; the Cadence schema was not checked here.
- Per-user JWT (https://docs.knock.app/in-app-ui/security-and-authentication): sign with the environment's private signing key using RS256; token must carry `sub` = the user id (recommended `iat`, `exp`). The grant key is `https://api.knock.app/v1/users/<user_id>` and "should match the `sub` claim." Node helper `signUserToken` from `@knocklabs/node/lib/tokenSigner` (`signingKey`, `expiresInSeconds`; default 3600). Signing key is under Platform > API keys, shown once, conventionally in `KNOCK_SIGNING_KEY`; use the base-64 PEM format if RS256 complains about key type.
- Refresh: simplest is expiry equal to session expiry; otherwise refresh via the `onUserTokenExpiring` callback and call `authenticate` again with the new token to restart the socket. Client passes `userToken` on `KnockProvider` or `knockClient.authenticate(user, token)`.
- Signed-user-token requests are rate-limited per environment and signing user (rate limits page).

## Summary of unanswered items

- Trigger endpoint rate-limit tier (page table did not render).
- Behaviour of trigger endpoint and feed during a Knock outage; no status/reliability docs page.
- SSR behaviour and React Router guidance (no first-party docs; only `enabled` prop and web-only note).
- Where in-app branding shows, and whether headless shows any.
