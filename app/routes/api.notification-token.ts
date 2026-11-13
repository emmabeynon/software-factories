import { data } from "react-router";
import type { Route } from "./+types/api.notification-token";
import { getCurrentUserId } from "~/lib/session";
import { notificationFeedConfig } from "~/lib/notification-feed-token.server";

/**
 * A fresh signed Notification Feed token for the signed-in user. The live
 * connection calls this shortly before its 1-hour token expires. The userId
 * lets the caller refuse a token for a different user (DevUI switch).
 */
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) throw data("Select a user from the DevUI panel", { status: 401 });

  const config = await notificationFeedConfig(userId);
  if (!config) throw data("Notifications are not configured", { status: 404 });

  return { userId: config.userId, userToken: config.userToken };
}
