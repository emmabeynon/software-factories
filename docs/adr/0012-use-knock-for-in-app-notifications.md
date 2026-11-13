# Use Knock for in-app Notifications, on its hosted free plan

Cadence sends Notifications (refund decisions, Seats claimed, Instructor comments and replies) through Knock, a hosted service, and shows them as a bell with an unread count that opens a popover Notification Feed. We chose Knock because its free plan (10,000 messages a month, no workflow cap) fits our volume, it offers both drop-in components and headless hooks for the bell-and-popover look, and its feed updates in real time with nothing for us to run. This sits beside ADR 0006's single SQLite file, but Notification content and read state live at Knock, not in `data.db`.

## Considered Options

- **Novu.** Rejected: the free plan caps workflows at 5 and we have about 8 kinds, and its open-source exit path means running Redis, MongoDB and S3 ourselves.
- **Courier.** Rejected: it bills every send from the first one, it is unclear whether Inbox is on the free plan, and its docs cover only Next.js.
- **A notifications table in our own SQLite.** Rejected: it is the cheapest and simplest fit for in-app only, but we want a third-party service. It stays the benchmark if we reopen this.

## Consequences

Read state, preferences and feed history live at Knock, so moving off later means rebuilding them elsewhere. Feed items are kept indefinitely and stay fetchable through the API, and only message logs are kept 30 days on the free plan. There is no self-serve bulk export on the free plan (a warehouse export is Enterprise-only), so the paginated list APIs are the only way out. Knock documents nothing about server-side rendering in React Router, or about what happens when Knock is down, so check both during the build. The free plan carries Knock branding, which probably does not show in a headless UI built on the hooks, but the docs do not say.
