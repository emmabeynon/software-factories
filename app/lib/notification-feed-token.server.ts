import { signUserToken } from "@knocklabs/node";

import type { NotificationFeedConfig } from "./notification-feed";

const TOKEN_LIFETIME_SECONDS = 60 * 60;

/**
 * Null when Knock isn't configured (no keys), so Cadence runs with no Knock
 * account and the feed shows its empty state. Vite doesn't put non-VITE_
 * values on process.env, so the real environment loads .env itself.
 */
export async function notificationFeedConfig(
  userId: number,
  env: Record<string, string | undefined> = process.env
): Promise<NotificationFeedConfig | null> {
  if (env === process.env && !env.KNOCK_SIGNING_KEY) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // No .env: run without Knock.
    }
  }

  const publicApiKey = env.KNOCK_PUBLIC_API_KEY;
  const signingKey = env.KNOCK_SIGNING_KEY;
  const feedChannelId = env.KNOCK_FEED_CHANNEL_ID;
  if (!publicApiKey || !signingKey || !feedChannelId) return null;

  return {
    userId: String(userId),
    userToken: await signUserToken(String(userId), {
      signingKey,
      expiresInSeconds: TOKEN_LIFETIME_SECONDS,
    }),
    publicApiKey,
    feedChannelId,
  };
}
