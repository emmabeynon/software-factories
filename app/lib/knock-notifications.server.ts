import Knock from "@knocklabs/node";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationCategory,
  type NotificationPort,
  type NotificationPreferences,
} from "./notifications.server";

// ─── Knock adapter ───
// The only place that knows Knock's names. Cadence names map to Knock keys here.
// Not covered by automated tests: tests use the in-memory fake (notifications.fake.ts).

/** Cadence category to the Knock category key set on each workflow. */
const KNOCK_CATEGORY: Record<NotificationCategory, string> = {
  refund_request_updates: "refund-request-updates",
  open_refund_requests: "open-refund-requests",
  seat_claims: "seat-claims",
  enrollments: "enrollments",
  discussion_questions: "discussion-questions",
  discussion_replies: "discussion-replies",
};

/** Cadence's Notification Feed channel, as Knock names it in preferences. */
const FEED_CHANNEL = "in_app_feed";
const PREFERENCE_SET = "default";

const CATEGORIES = Object.keys(KNOCK_CATEGORY) as NotificationCategory[];

function knockId(userId: number) {
  return String(userId);
}

export function knockNotifications(secretKey: string): NotificationPort {
  const knock = new Knock({ apiKey: secretKey });

  return {
    adapter: "knock",

    async trigger(notification) {
      await knock.workflows.trigger(
        notification.kind,
        {
          // Passing the recipient inline also creates or updates the Knock user.
          recipients: notification.recipients.map((recipient) => ({
            id: knockId(recipient.id),
            name: recipient.name,
            email: recipient.email,
            avatar: recipient.avatarUrl,
          })),
          actor:
            notification.actorId === null
              ? undefined
              : knockId(notification.actorId),
          data: notification.data,
        },
        { headers: { "Idempotency-Key": notification.idempotencyKey } }
      );
    },

    async syncUser(user) {
      await knock.users.update(knockId(user.id), {
        name: user.name,
        email: user.email,
        avatar: user.avatarUrl,
      });
    },

    async getPreferences(userId) {
      let set;
      try {
        set = await knock.users.getPreferences(knockId(userId), PREFERENCE_SET);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }

      const saved = set.categories;
      if (!saved || Object.keys(saved).length === 0) return null;

      const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
      for (const category of CATEGORIES) {
        const entry = saved[KNOCK_CATEGORY[category]];
        if (typeof entry === "boolean") {
          preferences[category] = entry;
        } else if (entry?.channel_types?.[FEED_CHANNEL] !== undefined) {
          preferences[category] = entry.channel_types[FEED_CHANNEL] === true;
        }
      }
      return preferences;
    },

    async setPreferences(userId, preferences: NotificationPreferences) {
      const categories = Object.fromEntries(
        CATEGORIES.map((category) => [
          KNOCK_CATEGORY[category],
          { channel_types: { [FEED_CHANNEL]: preferences[category] } },
        ])
      );
      await knock.users.setPreferences(knockId(userId), PREFERENCE_SET, {
        categories,
      });
    },

    // Not yet exercised against Knock: the trigger_data filter is unverified without credentials.
    async archiveForComment(commentId) {
      const messageIds: string[] = [];
      for await (const message of knock.messages.list({
        trigger_data: JSON.stringify({ commentId }),
      })) {
        messageIds.push(message.id);
      }
      if (messageIds.length === 0) return; // an empty batch returns 422
      await knock.messages.batch.archive({ message_ids: messageIds });
    },
  };
}

function isNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}
