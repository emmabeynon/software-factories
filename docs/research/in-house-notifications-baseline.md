# Research: In-house notifications baseline

Answers issue #5 (part of map #1). Question: what would it take to build in-app notifications ourselves in Cadence (SQLite via Drizzle, React Router, one server process, ADR 0006)? This is the baseline the vendors must beat. It reports facts and a rough size, not a decision.

Sources: this repo's code at commit `2d8a68e` (paths below), ADRs and GLOSSARY.md in the checkout root, and primary docs (React Router, MDN, SQLite, Drizzle) linked inline. Anything not read from a primary source is marked **(inference)**.

## 1. What the repo gives us today

- **One SQLite file, one writer, one process.** ADR 0006: `data.db` via `better-sqlite3`, synchronous, through Drizzle; "one writer at a time" and no multi-machine. `app/db/index.ts` opens it lazily with `journal_mode = WAL` and `foreign_keys = ON`. SQLite's WAL docs confirm readers don't block the writer and vice versa, with one writer at a time ([sqlite.org/wal.html](https://www.sqlite.org/wal.html)). Notification writes are tiny, so this is unlikely to matter at Cadence's volume **(inference)**.
- **Schema conventions** (`app/db/schema.ts`): integer autoincrement `id`; `userId` FKs to `users.id`; timestamps as ISO text via `$defaultFn(() => new Date().toISOString())`; enums as TS `enum` stored as `text(...).$type<Enum>()`; nullable timestamp for state (`completedAt`, `resolvedAt`, `deletedAt`, `editedAt`); indexes via the table's third argument. Migrations are `drizzle/000N_*.sql` (10 so far), generated with `npm run db:generate`; the repo has a `database-migrations` skill (migration, seed, reseed).
- **People.** `users.role` is `student | instructor | admin` (`UserRole`; "admin" is the glossary's Platform Admin). Team Admin is not a role: it is `team_members.role = 'admin'` (`TeamMemberRole`), looked up by `getTeamForAdmin` in `app/routes/layout.app.tsx`.
- **Current user plumbing.** `getCurrentUserId(request)` from `app/lib/session.ts` (cookie session, `userId`). `layout.app.tsx` wraps every authenticated route; its loader already returns `currentUser`, `isTeamAdmin` and sidebar data, and renders `<Sidebar>` plus a sonner `<Toaster>` (so a toast mechanism exists).
- **Existing event sites.**
  - `app/routes/courses.$slug.refund.ts` is a resource route (`action` only). After inserting into `refunds` it builds the reversal email and `console.log`s it (ADR 0010). That is the obvious trigger point: add one `createNotification(...)` call beside the `console.log`.
  - **No route in this checkout approves or declines a Refund Request.** `RefundStatus.Approved/Declined` and `resolvedAt`/`resolvedByUserId` exist in the schema but nothing writes them (grep of `app/`). The map's "admin refunds route" does not exist yet, so notifications for "your refund was decided" and "new request for Platform Admins" depend on that being built first.
  - `app/routes/settings.tsx` shows the buyer's open Refund Requests (a pull-based "notification" of sorts).
- **No existing polling, SSE or revalidation.** Only `app/components/youtube-player.tsx` uses a timer. No route tests exist (`app/lib/*.test.ts` only).
- **Server runtime.** `react-router-serve` (`package.json` `start`), a single Node process; `react-router.config.ts` has `ssr: true`. React Router 8.3.0, drizzle-orm 0.45.x, drizzle-kit 0.31.x.
- `_internal/feature-ideas.md` item 23 already lists "In-App Notifications: bell icon with unread count for announcements, quiz results, coupon activity".

## 2. Table shape

One table is enough. Following the repo's conventions:

```ts
export enum NotificationKind {
  RefundRequested = "refund_requested", // -> Platform Admins (and/or buyer confirmation)
  RefundApproved = "refund_approved",   // -> Student (buyer)
  RefundDeclined = "refund_declined",   // -> Student (buyer)
  // further kinds are additive; stored as text, no DB-level enum
}

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id), // recipient
    kind: text("kind").notNull().$type<NotificationKind>(),
    // What the UI needs to render and link. JSON text, or typed nullable FKs
    // (refundId, courseId). JSON is simpler; FKs give integrity.
    payload: text("payload", { mode: "json" }).notNull(),
    readAt: text("read_at"), // null = unread
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("notifications_user_unread_idx").on(t.userId, t.readAt, t.createdAt)],
);
```

Notes:
- **Fan-out is one row per recipient.** "New Refund Request" to all Platform Admins is N inserts in one `db.transaction`, fine at this scale. Resolving "all Platform Admins" is `select id from users where role = 'admin'`.
- **Render at read time vs store the text.** Storing `kind` + `payload` and rendering copy in the UI keeps wording changeable; storing finished text freezes it.
- **Dedupe/idempotency** (a retry creating two rows) would need a unique key such as `(userId, kind, refundId)`; optional **(inference)**.
- **Retention.** Growth is slow; a delete-older-than job is optional and can wait.
- Adding the table is one `drizzle-kit generate` migration plus seed updates per the `database-migrations` skill.

## 3. Read/unread state

- Per-notification state is the nullable `readAt` column (same pattern as `completedAt`/`resolvedAt`).
- Unread count: `select count(*) from notifications where user_id = ? and read_at is null` (covered by the index above).
- "Mark one read" and "mark all read" are `update ... set read_at = now where user_id = ? [and id = ?]`. Always scope by `userId` from the session so a user can't mark someone else's.
- Mutations go through a React Router `action` (a resource route such as `api.notifications.ts`, the same convention as `api.switch-user.ts`) called with `useFetcher`. Per the docs, an action called via `<Form>`/`useFetcher` still revalidates matched UI loaders, so the bell's count refreshes by itself after marking read; a plain `fetch()` would not ([Resource routes](https://reactrouter.com/how-to/resource-routes), [Fetchers](https://reactrouter.com/how-to/fetchers)).

## 4. How the UI learns about new notifications (no real-time infrastructure)

Three options, all workable on one Node process. None needs new infrastructure.

### a) Load with the page (baseline, nearly free)
Add the unread count and latest N notifications to the `layout.app.tsx` loader (it already runs per-user queries; `better-sqlite3` is synchronous, so this is one or two cheap indexed queries). After any action, "all loader data on the page is revalidated" ([Actions](https://reactrouter.com/start/framework/actions)). Caveat: a layout loader is not necessarily re-run on every client navigation (it re-runs after actions, on param or search-param changes, or when asked; `shouldRevalidate` can tune this). So a user sitting on one page sees nothing new until they act or navigate. **(partly inference: the Revalidation Optimization page was not read in full)**

### b) Polling with `useRevalidator` (simplest live-ish)
`useRevalidator` is documented for this: "Revalidate the data on the page for reasons outside of normal data mutations like `Window` focus or polling on an interval" ([useRevalidator](https://reactrouter.com/api/hooks/useRevalidator)). A small client component in the layout runs `setInterval(() => revalidator.revalidate(), 30_000)` and/or revalidates on window focus. Cost: every poll re-runs the layout loader and the page's loaders, not just notifications. Cheaper variant: poll a dedicated resource route (for example `api.notifications.count`) with a fetcher GET, which only runs that one loader ([Fetchers](https://reactrouter.com/how-to/fetchers) shows loading data from a route's loader through a fetcher; the page doesn't document `fetcher.load` by name).
Latency is the poll interval (15-60s). Load is one indexed `count(*)` per open tab per interval, negligible on SQLite **(inference)**.

### c) Server-sent events (true push)
A resource route may return a plain `Response` (documented), so a loader returning `new Response(stream, { headers: { "Content-Type": "text/event-stream" } })` is plausible. The Resource routes page documents `Response` returns but not streaming bodies, and I did not verify this under `react-router-serve` **(inference)**. Client side is `EventSource` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)): one-way, auto-reconnect, server can set `retry`. MDN caveat: without HTTP/2, browsers cap SSE at 6 connections per browser and domain across tabs. Because there is one process, an in-memory `Map<userId, Set<controller>>` is enough to fan out after a DB insert; this works only because of ADR 0006's single machine and would break if the app scaled out **(inference)**. Needs heartbeats, abort cleanup and manual testing; the event would just tell the client to revalidate.
WebSockets are not provided by React Router and were not evaluated.

**Carry into the vendor comparison:** real-time (criterion 4) is the one criterion where in-house costs extra work. Polling gives seconds-to-a-minute latency for ~15 lines; SSE gives sub-second for roughly 100 lines plus connection-lifecycle risk.

## 5. Preferences

1. **None in v1.** Everyone gets every kind that targets them. Zero extra schema.
2. **Per-user, per-kind mute** (in-app only): a `notification_preferences` table `(userId, kind, enabled)` with a unique index on `(userId, kind)`, default-on when no row exists. `createNotification` checks it before inserting (a muted kind is never written). UI: a toggle per kind on `app/routes/settings.tsx` (which already loads the current user and has an `action`). One table, one query in the service, one settings section.
- Per-channel preferences (email/push) are out of scope for the map; that would need a `channel` column **(inference)**.
- Which kinds are mutable, and for which roles, is a product decision for later tickets.

## 6. UI

- Bell + unread badge in `app/components/sidebar.tsx` (icons come from `lucide-react`, ADR 0007) or a layout header; a dropdown listing the latest items with "mark all read"; each item links to its target (`/settings` for the buyer's refund state; a Platform Admin refunds page once it exists). `components.json` and `app/components/ui/` suggest shadcn primitives, so a popover can be added **(not verified)**.
- Optional: raise a sonner toast when polling sees the count increase (`<Toaster>` is already mounted in the layout).
- A full `/notifications` page (paginated) is optional.

## 7. Where notifications get triggered

- One server-only service module (for example `app/lib/notifications.server.ts`, matching `access.server.ts` and `country.server.ts`) exposing `createNotification`, `notifyAdmins`, `listForUser`, `unreadCount`, `markRead`, `markAllRead`. Routes call it in the same request, ideally inside the same `db.transaction` as the state change, so a notification can't exist for a change that rolled back. This is an advantage over a vendor: atomic with the domain write and no "vendor is down" failure mode (the map's open integration question).
- First kinds, given what exists: `refund_requested` (from `courses.$slug.refund.ts`; to the buyer as confirmation and/or to Platform Admins). `refund_approved/declined` have no emitter yet because no decision route exists in this checkout.
- Relation to ADR 0010: the `console.log` email stays; an in-app row can sit beside it or stand in for it. That is the map's "Replacing ADR 0010" question and is not decided here. An in-app row does not reach a user who never opens the app, so it can't fully replace email **(inference)**.

## 8. Rough size of the build

Estimates for this codebase's style, including tests (vitest exists; only `app/lib` has tests today). **(inference, not measured)**

| Piece | Rough size |
|---|---|
| Schema (`notifications` table + enum) + migration + seed rows | ~25 lines TS + generated SQL |
| Service module + unit tests (create, fan-out to admins, count, mark read, user scoping) | ~100 lines + ~100 lines tests |
| Layout loader additions (count + latest N) | ~15 lines |
| Resource route(s) for mark-read / mark-all-read (+ optional count endpoint for polling) | ~50-80 lines |
| Bell/dropdown component + polling hook | ~120-180 lines |
| Wire first trigger (refund route) | ~10 lines |
| **Core total (no preferences, polling)** | **~350-500 lines, about 1-2 focused days** |
| Preferences (table, check in service, settings UI) | +~100-150 lines, about +0.5 day |
| SSE instead of polling (stream route, in-memory registry, heartbeat, client hook, tests) | +~100-150 lines, about +1 day, more edge cases |
| Refund decision route (needed by two of the three kinds; a separate feature) | not counted |

Ongoing cost: we own copy, retention, and any future digest/email/push channel; email needs a mail provider anyway (ADR 0010).

## 9. What the baseline gives vs. lacks

Against the map's criteria:
1. **Fit with React Router on one server:** native; no new dependency or process; atomic with domain writes.
2. **Pricing at low volume:** zero marginal cost; the cost is engineering time (section 8).
3. **Per-user preferences and read/unread:** read/unread is trivial; preferences are an optional extra table.
4. **Real-time delivery:** not built in. Polling (seconds-to-minute latency) is cheap; SSE is possible but self-maintained and single-process only.
5. **Lock-in and migration:** none; data is in our file. Moving to a vendor later means a data export and replacing the service module, since callers only use that module **(inference)**.
- **Not provided in-house:** email/push/Slack channels, templating and workflows, batching/digests, delivery logs, a ready-made feed UI. Out of scope per the map, but a vendor bundles them.
- **Single-machine limit** inherited from ADR 0006: SSE fan-out via an in-memory registry only works with one process.

## 10. Gaps and unverified items

- No refund approve/decline route exists in this checkout, so I could not read how a Platform Admin decision would be wired.
- Not verified that streaming `Response` bodies work under `react-router-serve`.
- The React Router "Revalidation Optimization" page was not read in full; revalidation-on-navigation claims are limited to what the fetched pages stated.
- Drizzle's SQLite quickstart ([orm.drizzle.team/docs/get-started-sqlite](https://orm.drizzle.team/docs/get-started-sqlite)) shows passing an existing `better-sqlite3` instance via `drizzle({ client })` but doesn't cover `generate`/`migrate`; the repo's `package.json` scripts and `drizzle/` folder are the evidence for the migration flow.
- Line counts are estimates, not measured.
