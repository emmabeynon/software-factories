import { eq, and } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { Db } from "~/lib/refunds.server";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationCategory,
  type NotificationPort,
} from "./notifications.server";

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> =
  {
    refund_request_updates: "Refund Request updates",
    open_refund_requests: "Open Refund Requests",
    seat_claims: "Seat claims",
    enrollments: "Enrollments",
    discussion_questions: "Discussion Questions",
    discussion_replies: "Discussion Replies",
  };

export const NOTIFICATION_CATEGORIES = Object.keys(
  NOTIFICATION_CATEGORY_LABELS
) as NotificationCategory[];

export type PreferenceSwitch = {
  category: NotificationCategory;
  label: string;
  enabled: boolean;
};

/**
 * The switches this person sees on /settings, by what they are or have (not
 * by UserRole alone). A hidden switch keeps its default.
 */
export async function getNotificationPreferenceSwitches(
  db: Db,
  port: NotificationPort,
  userId: number
): Promise<PreferenceSwitch[]> {
  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return [];

  const hasPurchase = !!db
    .select({ id: schema.purchases.id })
    .from(schema.purchases)
    .where(eq(schema.purchases.userId, userId))
    .get();
  const isTeamAdmin = !!db
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.userId, userId),
        eq(schema.teamMembers.role, schema.TeamMemberRole.Admin)
      )
    )
    .get();
  const isInstructor = user.role === schema.UserRole.Instructor;
  const isPlatformAdmin = user.role === schema.UserRole.Admin;

  const shown: Record<NotificationCategory, boolean> = {
    refund_request_updates: hasPurchase,
    open_refund_requests: isPlatformAdmin,
    seat_claims: isTeamAdmin,
    enrollments: isInstructor,
    discussion_questions: isInstructor,
    discussion_replies: true,
  };

  const saved =
    (await port.getPreferences(userId)) ?? DEFAULT_NOTIFICATION_PREFERENCES;

  return NOTIFICATION_CATEGORIES.filter((category) => shown[category]).map(
    (category) => ({
      category,
      label: NOTIFICATION_CATEGORY_LABELS[category],
      enabled: saved[category],
    })
  );
}

/**
 * Changes one category and keeps the rest, because the port replaces the whole
 * set. Throws if the save fails so the caller can revert the switch.
 */
export async function setNotificationPreference(
  port: NotificationPort,
  userId: number,
  category: NotificationCategory,
  enabled: boolean
): Promise<void> {
  const existing =
    (await port.getPreferences(userId)) ?? DEFAULT_NOTIFICATION_PREFERENCES;
  await port.setPreferences(userId, { ...existing, [category]: enabled });
}
