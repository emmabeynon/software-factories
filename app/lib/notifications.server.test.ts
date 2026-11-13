import { describe, it, expect, vi } from "vitest";
import { inMemoryNotifications } from "./notifications.fake";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationsFromEnv,
  syncNotificationUser,
} from "./notifications.server";

const priya = {
  id: 7,
  name: "Priya",
  email: "priya@example.com",
  avatarUrl: "https://example.com/priya.png",
};

describe("syncing a user", () => {
  it("sends name, email and avatar", async () => {
    const notifications = inMemoryNotifications();

    await syncNotificationUser(notifications, priya);

    expect(notifications.syncs).toEqual([priya]);
  });

  it("writes the default preferences when the user has none: Enrollments off, the rest on", async () => {
    const notifications = inMemoryNotifications();

    await syncNotificationUser(notifications, priya);

    expect(notifications.preferenceWrites).toEqual([
      {
        userId: 7,
        preferences: {
          refund_request_updates: true,
          open_refund_requests: true,
          seat_claims: true,
          enrollments: false,
          discussion_questions: true,
          discussion_replies: true,
        },
      },
    ]);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.enrollments).toBe(false);
  });

  it("never overwrites preferences the user already has", async () => {
    const notifications = inMemoryNotifications();
    await notifications.setPreferences(7, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enrollments: true,
      seat_claims: false,
    });
    notifications.preferenceWrites.length = 0;

    await syncNotificationUser(notifications, { ...priya, name: "Priya K" });

    expect(notifications.preferenceWrites).toEqual([]);
    expect(await notifications.getPreferences(7)).toMatchObject({
      enrollments: true,
      seat_claims: false,
    });
    expect(notifications.syncs.at(-1)?.name).toBe("Priya K");
  });

  it("catches and logs a failing port instead of throwing", async () => {
    const notifications = inMemoryNotifications();
    notifications.failWith(new Error("Knock is down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      syncNotificationUser(notifications, priya)
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("choosing the adapter", () => {
  it("is the no-op, which does nothing but log, when there is no secret key", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const port = await notificationsFromEnv({});

    expect(port.adapter).toBe("no-op");
    await expect(port.syncUser(priya)).resolves.toBeUndefined();
    expect(await port.getPreferences(7)).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("is Knock when a secret key is set", async () => {
    const port = await notificationsFromEnv({ KNOCK_SECRET_API_KEY: "sk_test" });

    expect(port.adapter).toBe("knock");
  });
});
