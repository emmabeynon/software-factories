# Research: Novu for in-app notifications

Issue: emmabeynon/software-factories#3 (map #1). Researched 2026-11-12. Facts only, from Novu's own docs, pricing page and GitHub repo. No decision is made here.

## Summary against the map's five criteria

| Criterion | Finding |
| --- | --- |
| 1. Fit with React Router app on one server | Embeddable React `<Inbox />` (`@novu/react`) plus a headless hooks/JS API (`@novu/js`). Server triggers via REST or `@novu/api` Node SDK. Novu is a separate hosted service; self-hosting needs several extra services (see below). |
| 2. Pricing at low volume | Free: $0, 10,000 workflow runs/month. Pro from $30. Subscribers unlimited on Free/Pro/Team. Self-hosted core is MIT but heavy to run. |
| 3. Preferences and read/unread | Both built in: global + per-workflow, per-channel preferences; read/unread/archive via Inbox and headless API. |
| 4. Real-time delivery | Yes, websocket-based, in both Inbox and headless hooks. |
| 5. Lock-in and migration | Workflows/templates live in Novu (dashboard or code-based framework). Core is MIT (self-host possible). No documented bulk data-export endpoint found. |

## 1. Fit: Inbox component vs API

- Inbox is a React component from `@novu/react` (React 18+, React 19 supported). Framework-agnostic JS is `@novu/js`. Customisable: styling, replacing sub-components, tabs, filters, localisation, snoozing. Source: https://docs.novu.co/platform/inbox/overview
- Headless: `useNotifications`, `useCounts`, and `useNovu` client (`novu.notifications.read/archive`) let you build a custom UI. Source: https://docs.novu.co/platform/inbox/headless/get-started
- React quickstart renders `<Inbox applicationIdentifier subscriberId routerPush />`; `routerPush` is for React Router navigation. Subscriber is auto-created if missing. Workflow with an In-App step is created in the dashboard. Source: https://docs.novu.co/platform/quickstart/react
- No dedicated React Router quickstart was found (the URL tried returned 404). Quickstarts listed in the Inbox overview are Next.js and React.
- Server side: `POST https://api.novu.co/v1/events/trigger` (EU: `eu.api.novu.co`), header `Authorization: ApiKey <secret>`, body `name` (workflow trigger id), `to` (subscriber id/object/topic, up to 100), `payload`. Node SDK: `new Novu({ secretKey }).trigger({ workflowId, payload, to })`. Optional `Idempotency-Key` header. Source: https://docs.novu.co/api-reference/events/trigger-event
- Auth: browser uses public `applicationIdentifier` plus `subscriberId`. Optional HMAC (`HMAC-SHA256(secretKey, subscriberId)` as `subscriberHash`) computed on our server; if enabled and the hash is missing the Inbox won't load. Source: https://docs.novu.co/platform/inbox/prepare-for-production
- Model: a workflow (channels, templates, logic) is triggered by an event for subscribers. Source: https://docs.novu.co/platform/concepts/notifications
- Self-hosted stack: API, Worker, WS services, Dashboard, Redis, MongoDB, S3-compatible object storage. Single-VM option: 4 vCPU / 8 GB for services combined; Redis 2 GB (AOF on), MongoDB 2 GB RAM / 20 GB disk, 10 GB object storage minimum. Social login unsupported; self-hosted team members: 1. Sources: https://docs.novu.co/community/self-hosting-novu/overview and https://docs.novu.co/community/self-hosted-and-novu-cloud
- This is a different shape from the app's single process + one SQLite file (ADR 0006): Novu cloud keeps notification state outside our DB; self-hosted adds MongoDB and Redis.

## 2. Pricing at low volume

Sources: https://novu.co/pricing and https://docs.novu.co/platform/account/billing

| Plan | Price | Included | Notes |
| --- | --- | --- | --- |
| Free | $0/mo | 10,000 workflow runs/mo, up to 5 workflows, 2 environments, 3 team members, 24h activity feed retention | 60 RPS. At the limit, Free "stops new workflow runs"; trigger requests rejected with HTTP 402. |
| Pro | from $30/mo | 30,000+ runs, 20 workflows, 7-day activity feed retention | $1.20 per 1K extra runs, 240 RPS |
| Team | from $250/mo | 250,000+ runs, up to 10 environments, 90-day retention, unlimited team members | $1.20 per 1K extra runs, 600 RPS |
| Enterprise | custom | 10M+ runs, custom retention | |

- Subscribers: "Unlimited" on Free, Pro, Team. MAU not mentioned.
- Billing unit is the workflow run: one trigger to one subscriber = 1 run; a topic trigger = 1 run per subscriber. Muted channels or skipped steps still count. Subscribers, messages, steps and provider costs are not billed. All environments share one monthly total. Source: billing docs (above) and https://docs.novu.co/platform/concepts/trigger
- "Activity feed retention" is the dashboard activity feed. The pricing page also has an "Inbox feed retention" row, but the fetched text could not be reliably matched to plans. Billing docs do not state end-user inbox history length. Unresolved; re-check on the live pricing page.
- Self-hosted: core is MIT; the `enterprise` folder is under a commercial licence. Source: https://github.com/novuhq/novu. Cost is infrastructure (see sizing above); the docs read state no per-run fee for self-hosting.

## 3. Preferences and read/unread

- Preferences component: global preferences (baseline per channel) plus per-workflow, per-channel toggles; per-workflow choice overrides global. A workflow marked "critical" in the dashboard can't be disabled by users and is hidden from the preferences UI by default (`preferencesFilter`). Source: https://docs.novu.co/platform/inbox/react/components/preferences
- Read/unread: Inbox shows unread count on the bell and syncs marking as read. Headless: `novu.notifications.read({notificationId})`, `.archive(...)`, `useCounts` with `{ read: false }`. Mark-as-unread is mentioned but no code shown. Sources: Inbox overview and headless pages above.
- The headless page does not cover preferences; whether preferences are available via `@novu/js` without the component was not confirmed from these pages.
- State is stored by Novu, not in our SQLite.

## 4. Real-time delivery

- Inbox and headless hooks update in real time; `novu.on("notifications.notification_received")` and `"notifications.unread_count_changed"` events; the headless page says the former comes over a websocket. Source: headless page above.
- Websocket URL is configurable (`socketUrl`, e.g. `wss://eu.socket.novu.co` for the EU region). Self-hosted deployments run their own WS service. Sources: prepare-for-production page and self-hosting overview.
- No latency or delivery-guarantee figures were found.

## 5. Lock-in and migration

- Workflows and templates are defined in Novu's dashboard or via its code-based framework (listed as available in both cloud and self-hosted). Source: https://docs.novu.co/community/self-hosted-and-novu-cloud
- Self-hosting is a documented path (MIT core), and the API reference is the same across editions (self-hosting overview).
- Self-hosted vs cloud differences: Inbox components are available in both; snooze and removing Novu branding are Cloud-only; also Cloud-only: more than 2 environments, SSO, RBAC, MFA, email activity tracking.
- Data export: no export endpoint found in the fetched docs; the subscriber search endpoint (`GET /v2/subscribers`) is the only subscriber API page read. Not exhaustively checked.
- UI lock-in: using `<Inbox />` ties UI to `@novu/react`; headless hooks tie data access to Novu's client.

## Other channels (noted, not evaluated)

Novu also offers email (20 providers), SMS (37), push (8), chat (13), and in-app, in the same workflows. Source: https://github.com/novuhq/novu

## Gaps

- No React Router specific guide found; Next.js and React only.
- End-user Inbox history retention per plan not confirmed.
- Preferences via headless API, export tooling, and self-hosted Inbox behaviour in practice not verified.
