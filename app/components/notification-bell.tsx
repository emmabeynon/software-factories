import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Bell,
  Check,
  GraduationCap,
  MessageSquare,
  Receipt,
  Settings,
  UsersRound,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import {
  badgeLabel,
  EMPTY_FEED_STATE,
  relativeTime,
  type FeedCategory,
  type FeedNotification,
  type FeedState,
  type NotificationFeedClient,
  type NotificationFeedConfig,
} from "~/lib/notification-feed";

// The bell, badge and popover of the Notification Feed. It calls only the
// Cadence client port (NotificationFeedClient); the Knock adapter is created
// below and nothing else here knows Knock. With no config (no Knock keys) the
// feed simply stays empty.

const categoryIcon: Record<FeedCategory, React.ReactNode> = {
  discussion: <MessageSquare />,
  refund: <Receipt />,
  team: <UsersRound />,
  enrollment: <GraduationCap />,
};

/** Asks the server for a new token; refuses one issued for a different user. */
async function refreshFeedToken(userId: string): Promise<string> {
  const response = await fetch("/api/notification-token");
  if (!response.ok) throw new Error(`token refresh ${response.status}`);
  const body: { userId: string; userToken: string } = await response.json();
  if (body.userId !== userId) throw new Error("session user changed");
  return body.userToken;
}

/** One live connection per signed-in user, rebuilt when the user (or token) changes. */
function useNotificationFeed(config: NotificationFeedConfig | null) {
  const [state, setState] = useState<FeedState>(EMPTY_FEED_STATE);
  const [client, setClient] = useState<NotificationFeedClient | null>(null);

  const userId = config?.userId;
  const userToken = config?.userToken;
  useEffect(() => {
    setState(EMPTY_FEED_STATE);
    setClient(null);
    if (!config) return;

    let cancelled = false;
    let created: NotificationFeedClient | null = null;
    let unsubscribe: (() => void) | undefined;

    import("~/lib/knock-feed-client")
      .then(({ createKnockFeedClient }) => 
        createKnockFeedClient(config, () => refreshFeedToken(config.userId))
      )
      .then((next) => {
        if (cancelled) {
          next.close();
          return;
        }
        created = next;
        unsubscribe = next.subscribe(setState);
        setClient(next);
      })
      .catch((error) => {
        console.error("[notification feed] could not connect", error);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
      created?.close();
    };
    // The config object is new on every loader run; the user and token identify it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, userToken]);

  return { state, client };
}

export function NotificationBell({
  config,
}: {
  config: NotificationFeedConfig | null;
}) {
  const { state, client } = useNotificationFeed(config);
  const [open, setOpen] = useState(false);
  const label = badgeLabel(state.unseenCount);

  // Switching user (DevUI) gives a new feed, so an open popover closes.
  useEffect(() => setOpen(false), [config?.userId]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Opening marks everything seen (clears the badge); rows stay unread.
    if (next) void client?.markAllSeen();
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        title="Notifications"
        aria-label={
          label ? `Notifications, ${state.unseenCount} unseen` : "Notifications"
        }
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        {label && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {label}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <FeedPopover
            state={state}
            client={client}
            close={() => setOpen(false)}
          />
        </>
      )}
    </>
  );
}

function FeedPopover({
  state,
  client,
  close,
}: {
  state: FeedState;
  client: NotificationFeedClient | null;
  close: () => void;
}) {
  const navigate = useNavigate();
  const sentinel = useRef<HTMLDivElement>(null);

  // Infinite scroll: the sentinel at the end of the list loads the next page.
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !client) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void client.loadMore();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [client, state.hasMore, state.notifications.length]);

  function openRow(notification: FeedNotification) {
    void client?.markRead(notification.id);
    // Nowhere to go: only mark it read and leave the popover open.
    if (!notification.destination) return;
    close();
    navigate(notification.destination);
  }

  return (
    <div className="fixed left-56 top-2 z-50 ml-2 flex max-h-[calc(100vh-1rem)] w-[26rem] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl">
      <div className="flex items-center gap-2 bg-muted/60 px-4 py-3">
        <span className="font-semibold">Notifications</span>
        <button
          type="button"
          onClick={() => void client?.markAllRead()}
          disabled={state.unreadCount === 0}
          className="ml-auto text-xs font-medium text-primary hover:underline disabled:opacity-40 disabled:hover:no-underline"
        >
          Mark all as read
        </button>
        <Link
          to="/settings"
          onClick={close}
          title="Notification preferences"
          aria-label="Notification preferences"
          className="rounded-full p-1 text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <Settings className="size-4" />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto">
        {state.notifications.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            You're all caught up.
          </p>
        ) : (
          state.notifications.map((notification) => (
            <FeedRow
              key={notification.id}
              notification={notification}
              onOpen={() => openRow(notification)}
              onMarkRead={() => void client?.markRead(notification.id)}
            />
          ))
        )}
        <div ref={sentinel} className="h-3" />
      </div>
    </div>
  );
}

function FeedRow({
  notification,
  onOpen,
  onMarkRead,
}: {
  notification: FeedNotification;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const { sender, read } = notification;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent">
      <span className="relative shrink-0">
        {sender ? (
          <UserAvatar
            name={sender.name}
            avatarUrl={sender.avatarUrl}
            className={cn("size-9", read && "opacity-60")}
          />
        ) : (
          // Notifications from Cadence itself have no sender.
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground",
              read && "opacity-60"
            )}
          >
            C
          </span>
        )}
        <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-popover text-muted-foreground ring-1 ring-border [&_svg]:size-2.5">
          {categoryIcon[notification.category]}
        </span>
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span
          className={cn("block truncate text-sm", !read && "font-semibold")}
        >
          {notification.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {notification.snippet} · {relativeTime(notification.createdAt)}
        </span>
      </button>
      {!read && (
        <button
          type="button"
          onClick={onMarkRead}
          title="Mark as read"
          aria-label="Mark as read"
          className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-background hover:text-primary"
        >
          <Check className="size-4" />
        </button>
      )}
    </div>
  );
}
