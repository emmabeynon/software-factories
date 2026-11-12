# Research: Knock for in-app notifications

Issue: emmabeynon/software-factories#2 (map: #1). Sources are Knock's own docs and pricing page, fetched 2026-11-12. Facts only; no decision.

## Summary against the map's criteria

| # | Criterion | Finding |
|---|-----------|---------|
| 1 | Fit with React Router app on one server | Both: drop-in React components and headless hooks/API. Client talks to Knock directly; our server triggers workflows and (in production) signs user tokens. No Knock-side infra on our server. |
| 2 | Pricing at low volume | Free: $0, 10,000 messages/month. Starter $250/month. |
| 3 | Preferences, read/unread | Per-user PreferenceSet (categories, workflows, channel types). Seen/read/archived state tracked per feed item. |
| 4 | Real-time delivery | Feed is real-time over a socket connection; no infra setup needed. |
| 5 | Lock-in / migration | Workflows/templates can be pulled to the repo via CLI. Message logs kept 30 days (free); docs mention no export option. |

## 1. Embeddable feed vs API; fit with React Router on one server

- Drop-in components in `@knocklabs/react`: `NotificationFeedPopover`, `NotificationFeed`, `NotificationIconButton` (bell with unread/unseen count). A complete set of React hooks supports a custom UI; Knock also exposes lower-level APIs for feeds and preferences. Client SDKs: React, JS, React Native, Swift, Kotlin, Flutter. (https://docs.knock.app/in-app-ui/overview, https://docs.knock.app/in-app-ui/react/overview)
- Setup: `KnockProvider` (public API key + user id) wraps `KnockFeedProvider` (`feedId` = the in-app channel ID); with enhanced security, a signed `userToken` is passed. (https://docs.knock.app/in-app-ui/react/feed)
- Server side: workflows are triggered via `POST /workflows/:key/trigger` (direct API call; also source event, schedule, audience join). Only this endpoint accepts an `Idempotency-Key` header. (https://docs.knock.app/send-notifications/triggering-workflows/overview, https://docs.knock.app/reference)
- Auth: with the public key alone, any user can be impersonated (documented as dev/test only). Production needs "enhanced security mode": our server signs an RS256 JWT per user (`sub` = user id) with a signing key, delivers it to the client, and refreshes before expiry; the Node SDK has a `signUserToken` helper. (https://docs.knock.app/in-app-ui/security-and-authentication)
- Not covered in the pages read: SSR support, React Router specifics. Knock is a hosted service, so nothing is stored in our SQLite; users must exist in Knock (identify).
- Rate limits: per-endpoint, 429 on exceed, scoped per environment for API keys; trigger endpoint's tier not stated on the page read. (https://docs.knock.app/reference)

## 2. Pricing (https://knock.app/pricing)

| Plan | Price | Messages/month | Notes |
|------|-------|----------------|-------|
| Free | $0, no card | up to 10,000 | Unlimited stored profiles, workflows, in-app feeds, channels, team members; Knock branding not removed; 30-day log retention; 99.9% uptime SLA listed |
| Starter | $250/month + usage | 50,000, then $0.005 each | Branding removed; email support |
| Enterprise | Custom | volume-based | 90-day logs, SSO, audit logs, etc. |

- A message = one delivery to one user on one channel (in-app plus email = 2). Failed/bounced sends and workflows suppressed by preferences are not billed.
- Free has no hard cap: over the limit without a billing method, Knock contacts you to set one up for next month.
- "Guide recipients" (in-app banners/popups/announcements) is a separate meter (free: 500/month); feed notifications are messages.
- Downstream providers (Postmark, Twilio) are billed separately.

## 3. Preferences and read/unread state

- Preferences: a `PreferenceSet` per user with keys `categories`, `channels`, `channel_types`, `workflows` (booleans); unset means opted in. A notification is blocked if any of its categories is false. Recipient preferences override tenant/environment defaults. Read/write via Preferences API; hosted preference center (signed URL, configured in dashboard, `default` set only) or a custom UI. Available on all plans. (https://docs.knock.app/preferences/overview, pricing page)
- Read state: Knock tracks seen, read and archived per message with badge counts. By default opening the popover marks items seen and the badge counts unseen; `badgeCountType="unread"` bases it on read; `feedClient.markAsRead(...)` marks read. Feed can be filtered to unread via `FilterStatus.Unread`. (https://docs.knock.app/in-app-ui/overview, https://docs.knock.app/in-app-ui/react/feed)
- Feed items are not subject to the log retention window; their status can still be fetched and updated. Pricing page lists feed retention as unlimited on all plans. (https://docs.knock.app/manage-your-account/data-retention)

## 4. Real-time delivery

- The in-app API includes websocket support with no infrastructure setup (overview page). The feed page says "socket connections" and does not name the transport.
- Options: `auto_manage_socket_connection` (disconnect inactive tabs after 2000 ms default, reconnect on focus); experimental `__experimentalCrossBrowserUpdates` syncs tabs via BroadcastChannel. Real-time toasts have a guide in the React docs. (https://docs.knock.app/in-app-ui/react/feed)
- No latency figures found on pages read.

## 5. Lock-in and migration cost

- Config as code: the Knock CLI (`knock pull`/`knock push`) moves workflows and templates to local files in our repo, usable in CI/CD across environments. (https://docs.knock.app/cli/overview)
- API: OpenAPI spec published; users/objects have cursor-paginated `list` methods (50 per page, `total_count` capped at 10,000); bulk identify/set-preferences/delete endpoints. Docs read do not describe a bulk export of users or messages. (https://docs.knock.app/api-reference/overview)
- Retention: message and delivery logs 30 days (Free/Starter), 90 (Enterprise); custom windows unsupported; no export option mentioned. Feed items persist beyond that. (https://docs.knock.app/manage-your-account/data-retention)
- Practical coupling: our code would depend on Knock's trigger API, user identification, signed tokens, and (if used) its React components. Notification and read-state history lives in Knock.

## Other channels (noted only)

Knock channel types: Email, In-app feed, In-app guide, Push, SMS, Chat, Webhook. (https://docs.knock.app/concepts/channels). Not evaluated.

## Gaps (not answered by the pages read)

- SSR behaviour and any React Router guidance.
- Trigger endpoint rate-limit tier.
- Real-time transport name and latency.
- Whether a user/message data export exists beyond paginated list APIs.
- Behaviour when Knock is unavailable.
