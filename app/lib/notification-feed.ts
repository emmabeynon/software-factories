// ─── Notification Feed, client side ───
// Cadence's own language for the feed (see GLOSSARY.md and docs/adr/0012). Feed
// components call only the NotificationFeedClient port; only the adapter
// (knock-feed-client.ts) knows Knock. Nothing here touches the browser or Knock.

import { formatPrice } from "~/lib/utils";

export type FeedCategory = "discussion" | "refund" | "team" | "enrollment";

/** Who caused a Notification. Null for Notifications from Cadence itself. */
export type FeedSender = { name: string; avatarUrl: string | null };

export type FeedNotification = {
  id: string;
  category: FeedCategory;
  title: string;
  /** One line of context. */
  snippet: string;
  sender: FeedSender | null;
  /** The most specific place it concerns; null when there is nowhere to go. */
  destination: string | null;
  read: boolean;
  /** ISO timestamp. */
  createdAt: string;
};

export type FeedState = {
  notifications: FeedNotification[];
  /** Drives the bell badge. Seen is not read. */
  unseenCount: number;
  unreadCount: number;
  hasMore: boolean;
  loadingMore: boolean;
};

export const EMPTY_FEED_STATE: FeedState = {
  notifications: [],
  unseenCount: 0,
  unreadCount: 0,
  hasMore: false,
  loadingMore: false,
};

/**
 * What the browser needs to read one person's feed: the public key, the feed
 * channel and a user token the server signed for that person (RS256, sub =
 * Cadence user id). The signing key never leaves the server.
 */
export type NotificationFeedConfig = {
  userId: string;
  userToken: string;
  publicApiKey: string;
  feedChannelId: string;
};

/** Fetches a fresh signed token for the same user, before the current one expires. */
export type RefreshFeedToken = () => Promise<string>;

export interface NotificationFeedClient {
  /** Calls the listener now and on every change, including live arrivals. */
  subscribe(listener: (state: FeedState) => void): () => void;
  loadMore(): Promise<void>;
  markRead(id: string): Promise<void>;
  /** Covers Notifications that haven't loaded into the list yet. */
  markAllRead(): Promise<void>;
  /** Clears the badge. Does not change what is unread. */
  markAllSeen(): Promise<void>;
  /** Tears down the live connection. */
  close(): void;
}

/** Red badge text: the count, capped at "9+", nothing when zero. */
export function badgeLabel(unseenCount: number): string | null {
  if (unseenCount <= 0) return null;
  return unseenCount > 9 ? "9+" : String(unseenCount);
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

type Presented = Pick<
  FeedNotification,
  "category" | "title" | "snippet" | "destination"
>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * What a Notification says, written from its kind and data. Cadence writes the
 * content, not Knock templates. Unknown kinds still render a generic row.
 */
export function presentNotification(
  kind: string,
  data: Record<string, unknown>
): Presented {
  const courseTitle = text(data.courseTitle);
  const courseSlug = text(data.courseSlug);
  const courseUrl = courseSlug ? `/courses/${courseSlug}` : null;
  const note = text(data.decisionNote);
  const amountText =
    typeof data.amountPaid === "number" ? formatPrice(data.amountPaid) : "";

  switch (kind) {
    case "refund-approved":
      return {
        category: "refund",
        title: "Your Refund Request was approved",
        snippet: note || courseTitle,
        destination: courseUrl,
      };
    case "refund-declined":
      return {
        category: "refund",
        title: "Your Refund Request was declined",
        snippet: [note, data.canAskAgain ? "You can ask again." : ""]
          .filter(Boolean)
          .join(" ") || courseTitle,
        destination: courseUrl,
      };
    case "refund-confirmed":
      return {
        category: "refund",
        title: "We've received your Refund Request",
        snippet: courseTitle
          ? `${[courseTitle, amountText].filter(Boolean).join(", ")}, is under review.`
          : "It is under review.",
        destination: null,
      };
    case "refund-requested":
      return {
        category: "refund",
        title: `${text(data.buyerName) || "A buyer"} requested a refund`,
        snippet: [
          courseTitle,
          amountText,
          text(data.reason),
        ]
          .filter(Boolean)
          .join(" · "),
        destination: "/admin/refunds",
      };
    case "discussion-question":
    case "discussion-reply": {
      const lessonTitle = text(data.lessonTitle);
      const author = text(data.authorName) || "Someone";
      const inLesson = lessonTitle ? ` in ${lessonTitle}` : "";
      const hasAnchor =
        courseSlug && data.lessonId != null && data.commentId != null;
      return {
        category: "discussion",
        title:
          kind === "discussion-question"
            ? `${author} asked a question${inLesson}`
            : `${author} replied to your question${inLesson}`,
        snippet: text(data.snippet),
        destination: hasAnchor
          ? `/courses/${courseSlug}/lessons/${data.lessonId}#comment-${data.commentId}`
          : null,
      };
    }
    default:
      return {
        category: "discussion",
        title: "New notification",
        snippet: courseTitle,
        destination: null,
      };
  }
}
