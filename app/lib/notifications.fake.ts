import type {
  NotifiableUser,
  NotificationPort,
  NotificationPreferences,
  NotificationTrigger,
} from "./notifications.server";

/**
 * The in-memory adapter tests use. It records every call so a test can check
 * who was notified, with what, and which preferences were written. Never
 * touches Knock.
 */
export type FakeNotificationPort = NotificationPort & {
  triggers: NotificationTrigger[];
  syncs: NotifiableUser[];
  preferenceWrites: { userId: number; preferences: NotificationPreferences }[];
  archives: number[];
  /** Make every call throw, to prove a failing vendor never fails an action. */
  failWith(error: Error): void;
};

export function inMemoryNotifications(): FakeNotificationPort {
  const preferences = new Map<number, NotificationPreferences>();
  let failure: Error | null = null;

  function check() {
    if (failure) throw failure;
  }

  const port: FakeNotificationPort = {
    adapter: "in-memory",
    triggers: [],
    syncs: [],
    preferenceWrites: [],
    archives: [],
    failWith(error) {
      failure = error;
    },
    async trigger(notification) {
      check();
      port.triggers.push(notification);
    },
    async syncUser(user) {
      check();
      port.syncs.push(user);
    },
    async getPreferences(userId) {
      check();
      return preferences.get(userId) ?? null;
    },
    async setPreferences(userId, next) {
      check();
      preferences.set(userId, next);
      port.preferenceWrites.push({ userId, preferences: next });
    },
    async archiveForComment(commentId) {
      check();
      port.archives.push(commentId);
    },
  };

  return port;
}
