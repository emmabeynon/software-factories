import type { FeedItem } from "@knocklabs/client";
import {
  presentNotification,
  type NotificationFeedConfig,
  type FeedNotification,
  type FeedState,
  type NotificationFeedClient,
} from "./notification-feed";

// ─── Knock client adapter ───
// The only browser code that knows Knock. It talks to Knock with the public key
// and the user token the server signed, and maps Knock's feed into Cadence's
// own FeedState. Live updates come over Knock's socket (listenForUpdates), one
// connection per signed-in user; nothing polls. Not covered by automated tests.

const PAGE_SIZE = 100;

function toNotification(item: FeedItem): FeedNotification {
  const data = (item.data ?? {}) as Record<string, unknown>;
  // Every workflow key is a Cadence kind (see knock-notifications.server.ts).
  const presented = presentNotification(item.source.key, data);
  const actor = item.actors[0];
  const name = actor && "name" in actor ? actor.name : null;
  const avatar = actor && "avatar" in actor ? actor.avatar : null;

  return {
    id: item.id,
    ...presented,
    sender: name
      ? { name, avatarUrl: typeof avatar === "string" ? avatar : null }
      : null,
    read: item.read_at !== null,
    createdAt: item.inserted_at,
  };
}

export async function createKnockFeedClient(
  config: NotificationFeedConfig
): Promise<NotificationFeedClient> {
  // Imported here so the browser bundle loads Knock only when a feed exists.
  const { default: Knock } = await import("@knocklabs/client");

  const knock = new Knock(config.publicApiKey);
  knock.authenticate(config.userId, config.userToken);
  const feed = knock.feeds.initialize(config.feedChannelId, {
    page_size: PAGE_SIZE,
  });

  function snapshot(): FeedState {
    const state = feed.getState();
    return {
      notifications: [...state.items]
        .sort((a, b) => b.inserted_at.localeCompare(a.inserted_at))
        .map(toNotification),
      unseenCount: state.metadata.unseen_count,
      unreadCount: state.metadata.unread_count,
      hasMore: state.pageInfo.after !== null,
      loadingMore: state.loading,
    };
  }

  await feed.fetch();
  feed.listenForUpdates();

  return {
    subscribe(listener) {
      listener(snapshot());
      return feed.store.subscribe(() => listener(snapshot()));
    },
    async loadMore() {
      const { pageInfo, loading } = feed.getState();
      if (!pageInfo.after || loading) return;
      await feed.fetchNextPage();
    },
    async markRead(id) {
      const item = feed.getState().items.find((entry) => entry.id === id);
      if (item && !item.read_at) await feed.markAsRead(item);
    },
    async markAllRead() {
      await feed.markAllAsRead();
    },
    async markAllSeen() {
      await feed.markAllAsSeen();
    },
    close() {
      feed.teardown();
      knock.teardown();
    },
  };
}
