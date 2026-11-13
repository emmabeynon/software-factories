// ─── Notifications ───
// The server side of Notifications (see GLOSSARY.md and docs/adr/0012). Cadence
// code talks to this port in its own language; only adapters know about Knock.
// It mirrors MailTransport: services take it as a parameter, with a default
// chosen from the environment. Three adapters: Knock (knock-notifications.server.ts),
// an in-memory fake for tests (notifications.fake.ts), and the no-op below,
// used when KNOCK_SECRET_API_KEY is absent so Cadence runs with no Knock account.

export type NotificationCategory =
  | "refund_request_updates"
  | "open_refund_requests"
  | "seat_claims"
  | "enrollments"
  | "discussion_questions"
  | "discussion_replies";

/** One on/off switch per category. Only the Notification Feed channel exists. */
export type NotificationPreferences = Record<NotificationCategory, boolean>;

/** Every category is on by default, except Enrollments (opt-in). */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  refund_request_updates: true,
  open_refund_requests: true,
  seat_claims: true,
  enrollments: false,
  discussion_questions: true,
  discussion_replies: true,
};

/** What the vendor needs to know about a person. Role is never synced. */
export type NotifiableUser = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

export type NotificationData = Record<string, string | number | boolean | null>;

export type NotificationKind =
  | "refund-approved"
  | "refund-declined"
  | "refund-confirmed"
  | "refund-requested"
  | "seat-claimed"
  | "enrollment-created"
  | "discussion-question"
  | "discussion-reply";

export type NotificationTrigger = {
  kind: NotificationKind;
  category: NotificationCategory;
  recipients: NotifiableUser[];
  /** Who caused it; shown as the sender. Null for Notifications from Cadence itself. */
  actorId: number | null;
  /** One per domain event, so a retry layer added later cannot send duplicates. */
  idempotencyKey: string;
  data: NotificationData;
};

export interface NotificationPort {
  readonly adapter: "knock" | "in-memory" | "no-op";
  trigger(notification: NotificationTrigger): Promise<void>;
  syncUser(user: NotifiableUser): Promise<void>;
  /** The person's saved preferences, or null when none have been written. */
  getPreferences(userId: number): Promise<NotificationPreferences | null>;
  /** Replaces the whole set. Callers merge before writing. */
  setPreferences(
    userId: number,
    preferences: NotificationPreferences
  ): Promise<void>;
  /** Archives every Notification caused by this comment. */
  archiveForComment(commentId: number): Promise<void>;
}

export function noopNotifications(
  log: (message: string) => void = console.log
): NotificationPort {
  return {
    adapter: "no-op",
    async trigger(notification) {
      log(
        `[notifications:no-op] ${notification.kind} to ${notification.recipients
          .map((recipient) => recipient.id)
          .join(",")} (${notification.idempotencyKey})`
      );
    },
    async syncUser(user) {
      log(`[notifications:no-op] sync user ${user.id}`);
    },
    async getPreferences() {
      return null;
    },
    async setPreferences(userId) {
      log(`[notifications:no-op] set preferences for user ${userId}`);
    },
    async archiveForComment(commentId) {
      log(`[notifications:no-op] archive for comment ${commentId}`);
    },
  };
}

let cachedPort: NotificationPort | undefined;

/**
 * Knock when KNOCK_SECRET_API_KEY is set, otherwise the no-op. Vite does not
 * put non-VITE_ values on process.env, so the real environment loads .env itself.
 */
export async function notificationsFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<NotificationPort> {
  if (env === process.env && !env.KNOCK_SECRET_API_KEY) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // No .env: run without Knock.
    }
  }

  const secretKey = env.KNOCK_SECRET_API_KEY;
  if (!secretKey) return noopNotifications();

  const { knockNotifications } = await import("./knock-notifications.server");
  return knockNotifications(secretKey);
}

/** The port the app uses, chosen once from the environment. */
export async function defaultNotifications(): Promise<NotificationPort> {
  cachedPort ??= await notificationsFromEnv();
  return cachedPort;
}

/**
 * Runs a Notification call without ever letting it fail the caller. A failure,
 * thrown or rejected, is logged and swallowed. No retries in v1.
 */
export async function bestEffort(
  description: string,
  call: () => Promise<unknown>
): Promise<void> {
  try {
    await call();
  } catch (error) {
    console.error(`[notifications] ${description} failed`, error);
  }
}

/**
 * Tells the vendor who a person is and writes the default preference set, but
 * only if they have none yet. A later sync never overwrites their choices.
 * Never throws.
 */
export async function syncNotificationUser(
  port: NotificationPort,
  user: NotifiableUser
): Promise<void> {
  await bestEffort(`sync of user ${user.id}`, async () => {
    await port.syncUser(user);
    const existing = await port.getPreferences(user.id);
    if (!existing) {
      await port.setPreferences(user.id, DEFAULT_NOTIFICATION_PREFERENCES);
    }
  });
}

/** The vendor-facing shape of a person. Role and other fields are never synced. */
export function notifiable(user: NotifiableUser): NotifiableUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

/** One per domain event: `<kind>:<id>`, so a retry layer cannot send duplicates. */
export function idempotencyKey(kind: NotificationKind, id: number): string {
  return `${kind}:${id}`;
}

/** Introduces a person to the vendor via the app's default port. Never throws. */
export async function introduceToNotifications(
  user: NotifiableUser
): Promise<void> {
  await syncNotificationUser(await defaultNotifications(), user);
}
