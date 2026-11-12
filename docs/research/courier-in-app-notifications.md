# Research: Courier for in-app notifications

Issue: emmabeynon/software-factories#4 (map: #1). Researched 2026-11-12.
Sources are Courier's own docs and pricing page only. Facts only; no recommendation.

Sources:
- Pricing: https://www.courier.com/pricing
- Billing: https://www.courier.com/docs/workspaces/billing
- Inbox overview: https://www.courier.com/docs/platform/inbox/inbox-overview
- Inbox auth: https://www.courier.com/docs/platform/inbox/authentication
- React SDK: https://www.courier.com/docs/sdk-libraries/courier-react-web
- JS SDK: https://www.courier.com/docs/sdk-libraries/courier-js-web
- Preferences: https://www.courier.com/docs/platform/preferences/preferences-overview
- Users and profiles: https://www.courier.com/docs/platform/users/users
- Send API: https://www.courier.com/docs/api-reference/send/send-a-message
- Logs: https://www.courier.com/docs/monitor/logs , https://www.courier.com/docs/platform/analytics/message-logs

## Criterion 1: Fit with a React Router app on one server; embeddable feed or API

- Embeddable: React SDK ships `<CourierInbox />` and `<CourierInboxPopupMenu />` (themeable via `CourierInboxTheme`), plus `<CourierToast />` and `<CourierPreferences />`. React 18+ (`@trycourier/courier-react`) and React 17 packages exist. Web Components, Vue, Angular, iOS, Android, Flutter, React Native also listed.
- Build-your-own UI: the `useCourier()` hook returns `shared`, `auth`, `inbox`, `toast`, `preferences`, for custom UI. The JS SDK exposes low-level inbox methods (`getMessages`, `read`, `archive`, etc.). Inbox overview: "build a custom UI on the low-level APIs".
- Needs a server endpoint: the backend must mint a JWT with the Courier API key via `POST /auth/issue-token`, with scopes such as `user_id:<id> inbox:read:messages inbox:write:events`. The client calls `signIn({ userId, jwt })`. SDKs do not refresh tokens; the backend must mint a new one before `expires_in` lapses. Omitting `expires_in` makes a never-expiring token. Without the two inbox scopes the feed comes back empty.
- Sending: Node SDK `client.send.message({ message: { to: { user_id }, template, data } })` returns 202 with `requestId`. `inbox` is a listed channel ID. Supports an `Idempotency-Key` header (retained 25 hours by default, max 1 year).
- React Router / Remix: not mentioned in the docs pages read. The React SDK page says Inbox and Toast "support Next.js but render client-side only" (needs `'use client'` in Next 13+). Next.js and Astro quickstarts build a token route.
- One server process / SQLite: Courier is a hosted SaaS; the app holds no Courier state locally. A self-host option was not found in the pages read.
- Not stated: whether a user profile must exist before a send. Users docs say a send "looks up an existing profile, it doesn't persist one from the `to` object"; "Authenticating a user registers them" for Inbox; `POST /profiles/{user_id}` is an upsert.

## Criterion 2: Pricing at low volume

- Developer (free): 10,000 sends/month. Includes journeys, broadcasts, MCP server, CLI, SDKs, SSO via Google/GitHub, email and chat support.
- Business: $0.005 per send, pay-as-you-go, billed on every send including the first 10,000. Examples on the page: 50,000 sends = $250; 200,000 = $1,000. Adds AI Translations, AI node, EU data residency, optional Device Preview add-on from $20/month.
- Enterprise: custom, below $0.005 per send.
- A send = one template to one recipient. A multi-channel template = one send. A list of 100 users = 100 sends. Sends count whether or not delivered; Test and custom environments count too.
- No per-seat or channel add-on fees.
- Billing docs: "Sending more than 10,000 a month takes the Business plan" (credit card). Not stated: whether sends are blocked or throttled over 10,000 without a card.
- Not stated on the pricing, billing or inbox pages: whether Inbox is available on the free plan, or any Inbox-specific limits.
- Retention: the Logs page and Message Logs page both say "Developer and Business keep 30 days of message history. Enterprise keeps 365 days." A message's own event history is about 93 days on every plan. (A search-result snippet quoted 90 days for Business; the two pages fetched directly say 30, so 30 is the documented figure here.) This is about message logs; whether Inbox messages themselves expire on the same window is not stated.

## Criterion 3: Per-user preferences and read/unread state

- Read/unread: built-in unread counts and badges. JS SDK: `read`, `unread`, `open`, `click`, `archive`, `unarchive`; bulk `readAll`, `archiveRead`, `archiveAll`. `getMessages()` returns `count` and `unreadCount`; `getUnreadMessageCount()` and `getUnreadCounts(filters)` exist. Filters by `tags`, `archived`, `status`, `from`. State syncs across a user's signed-in devices. Read/unread state therefore lives at Courier.
- Preferences: subscription topics. Each topic has a default of `OPTED_IN`, `OPTED_OUT` or `REQUIRED` (set in the Preferences Editor); tenant defaults override it; user choices override both; `REQUIRED` overrides everything. Optional per-channel user routing when enabled per topic. A `<CourierPreferences />` component or hosted page lets users set choices; an API reads/writes preferences (endpoint formats not documented on the overview page).

## Criterion 4: Real-time delivery

- Inbox overview: messages "arrive in real time on web and mobile".
- JS SDK: `inbox.socket.connect()` and `addMessageEventListener(cb)`; events: new message, Read, Unread, Archive, ArchiveAll, ArchiveRead, Clicked, MarkAllRead, Opened, Unarchive, Unopened. The socket does not push a numeric unread total; refetch counts on events. React: call `inbox.listenForUpdates()` after auth or the inbox loads once and never updates. `signOut` "disconnects the real-time socket".
- The transport is named only as "socket" in the docs pages read. A WebSocket claim appeared in a search snippet of Courier's guides (marketing content), not confirmed in core docs.
- Browser push for a closed tab is a separate opt-in (per the same snippet, vendor-stated).

## Criterion 5: Lock-in and migration cost

- Notification content, templates, topics and routing live in Courier. Sends reference a template ID.
- Export: no bulk user export. Users docs: "Courier has no endpoint to list every `user_id`, export all profiles, or return a total user count." Profiles are fetched one at a time (`GET /profiles/{user_id}`); `GET /tenants/{tenant_id}/users` lists users in one tenant.
- Message history: `GET /messages` lists messages (filters by recipient, status, provider, tags; cursor paging) per a search snippet of the API docs; the CLI can list messages. Logs docs: "export anything you need to keep longer", given the retention window above. No documented bulk export of inbox read/archive state was found.
- `user_id` is your own identifier ("typically ... the user id of a user in your system"), so the user mapping stays in the app. Preferences and read state live at Courier, so moving off means rebuilding or migrating them.
- Enterprise-only: data warehouse integrations.

## Other channels (noted only, not evaluated)

- Pricing page: one send can cover email, SMS, push, Slack and in-app. Inbox overview documents mobile push via APNs/FCM. Send API channel IDs: email, sms, push, inbox, direct_message, banner, webhook.

## Gaps (not answered by the primary sources read)

- Inbox availability and limits on the free Developer plan.
- Behaviour when exceeding 10,000 sends without a card.
- Any React Router specific guidance, or self-hosting.
- Retention of Inbox messages themselves.
- Preferences API request formats.
- Core-docs confirmation of the WebSocket transport.
